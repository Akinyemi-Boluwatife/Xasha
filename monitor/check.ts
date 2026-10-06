export type MonitorBindings = {
  MONITOR_DB: D1Database
  READINESS_URL: string
  MONITOR_MODE: string
  ALERTS_ENABLED: string
  WEBHOOK_FORMAT: string
  ALERT_WEBHOOK_URL?: string
}

type State = { failures: number; notified_down: number }
type Dependencies = { fetch: typeof fetch; now: () => number }

async function probe(url: string, request: typeof fetch): Promise<{ ready: boolean; status: number | null }> {
  let response: Response | undefined
  try {
    response = await request(url, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    })
    if (response.status !== 200) return { ready: false, status: response.status }
    // Read only a bounded status response; never retain its body in monitor state.
    const reader = response.body?.getReader()
    if (!reader) return { ready: false, status: response.status }
    const decoder = new TextDecoder()
    let text = '', bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 1024) return { ready: false, status: response.status }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      const body = JSON.parse(text)
      return { ready: body?.status === 'ready' && body?.service === 'xasha', status: response.status }
    } finally { await reader.cancel().catch(() => {}) }
  } catch { return { ready: false, status: response?.status ?? null } }
  finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}) }
}

async function notify(env: MonitorBindings, kind: 'outage' | 'recovery', at: number, request: typeof fetch) {
  const url = new URL(env.ALERT_WEBHOOK_URL ?? '')
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid alert configuration.')
  const timestamp = new Date(at).toISOString()
  const message = kind === 'outage'
    ? `Xasha production is unavailable after three consecutive readiness failures. Checked at ${timestamp}.`
    : `Xasha production is ready again. Checked at ${timestamp}.`
  let payload: object
  if (env.WEBHOOK_FORMAT === 'slack') payload = { text: message }
  else if (env.WEBHOOK_FORMAT === 'discord') payload = { content: message, allowed_mentions: { parse: [] } }
  else if (env.WEBHOOK_FORMAT === 'json') payload = { service: 'xasha', event: kind, checkedAt: timestamp, message }
  else throw new Error('Invalid alert configuration.')
  const response = await request(url.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error('Alert delivery failed.')
}

export async function runCheck(env: MonitorBindings, scheduledAt: number,
  dependencies: Dependencies = { fetch, now: Date.now }): Promise<void> {
  if (env.MONITOR_MODE === 'paused') return
  if (env.MONITOR_MODE !== 'active' || !['true', 'false'].includes(env.ALERTS_ENABLED)
      || !Number.isSafeInteger(scheduledAt) || scheduledAt < 0) throw new Error('Invalid monitor configuration.')
  const target = new URL(env.READINESS_URL)
  if (target.protocol !== 'https:' || target.pathname !== '/ready' || target.search || target.hash
      || target.username || target.password) throw new Error('Invalid monitor target.')
  const db = env.MONITOR_DB
  const lease = crypto.randomUUID()
  try {
    const state = await db.prepare(
      `UPDATE monitor_state SET lease_id = ?1, lease_until = ?2
       WHERE singleton = 1 AND lease_until <= ?3 AND last_scheduled_at < ?4
       RETURNING failures, notified_down`,
    ).bind(lease, dependencies.now() + 120000, dependencies.now(), scheduledAt).first<State>()
    if (!state) {
      if (!await db.prepare('SELECT singleton FROM monitor_state WHERE singleton = 1').first()) {
        throw new Error('Monitoring state missing.')
      }
      return // Overlapping, duplicate, or out-of-order cron invocation.
    }
    try {
      const result = await probe(target.href, dependencies.fetch)
      const at = dependencies.now()
      const failures = result.ready ? 0 : Math.min(3, state.failures + 1)
      const unavailable = failures >= 3
      const stored = await db.prepare(
        `UPDATE monitor_state SET failures = ?1, unavailable = ?2, last_scheduled_at = ?3,
         last_checked_at = ?4, last_ok_at = CASE WHEN ?5 THEN ?4 ELSE last_ok_at END, last_http_status = ?6
         WHERE singleton = 1 AND lease_id = ?7 AND lease_until > ?4`,
      ).bind(failures, Number(unavailable), scheduledAt, at, Number(result.ready), result.status, lease).run()
      if (!stored.meta.changes) throw new Error('Monitoring lease expired.')
      const kind = unavailable && !state.notified_down ? 'outage'
        : result.ready && state.notified_down ? 'recovery' : null
      if (kind && env.ALERTS_ENABLED === 'true') {
        try {
          await notify(env, kind, at, dependencies.fetch)
          const deliveredAt = dependencies.now()
          const delivered = await db.prepare(
            `UPDATE monitor_state SET notified_down = ?1, last_alert_at = ?2, last_alert_error_at = NULL
             WHERE singleton = 1 AND lease_id = ?3 AND lease_until > ?2`,
          ).bind(Number(kind === 'outage'), deliveredAt, lease).run()
          if (!delivered.meta.changes) throw new Error('Monitoring lease expired.')
        } catch {
          await db.prepare('UPDATE monitor_state SET last_alert_error_at = ?1 WHERE singleton = 1 AND lease_id = ?2')
            .bind(dependencies.now(), lease).run()
          throw new Error('Monitoring alert failed.')
        }
      }
    } finally {
      await db.prepare('UPDATE monitor_state SET lease_id = NULL, lease_until = 0 WHERE singleton = 1 AND lease_id = ?1')
        .bind(lease).run()
    }
  } catch {
    // Never expose request bodies, webhook credentials, or database diagnostics.
    throw new Error('Monitoring execution failed.')
  }
}
