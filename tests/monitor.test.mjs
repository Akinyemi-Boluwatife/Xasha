import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runCheck } from '../monitor/check.ts'
import { setup } from './runtime.mjs'

async function monitor() {
  const { runtime, db } = await setup()
  const sql = await readFile('monitor/migrations/0001_monitor_state.sql', 'utf8')
  await db.batch(sql.split(';').filter(part => part.trim()).map(part => db.prepare(part)))
  const env = {
    MONITOR_DB: db, READINESS_URL: 'https://api.invalid/ready', MONITOR_MODE: 'active',
    ALERTS_ENABLED: 'false', WEBHOOK_FORMAT: 'json', ALERT_WEBHOOK_URL: 'https://alerts.invalid/private-token',
  }
  let time = 1700000000000
  let ready = true
  let deliveryStatus = 204
  let probeError = false
  const alerts = []
  const request = async (url, init) => {
    if (init.method === 'GET') {
      if (probeError) throw new Error('private exception detail')
      return Response.json({ service: 'xasha', status: ready ? 'ready' : 'unavailable' }, { status: ready ? 200 : 503 })
    }
    alerts.push(JSON.parse(init.body))
    return new Response(null, { status: deliveryStatus })
  }
  return {
    db, runtime, env, alerts, request,
    state: () => db.prepare('SELECT * FROM monitor_state WHERE singleton = 1').first(),
    setReady: value => { ready = value }, setDelivery: value => { deliveryStatus = value },
    setProbeError: value => { probeError = value },
    check: (override = request) => { time += 300000; return runCheck(env, time, { fetch: override, now: () => time }) },
    duplicate: (override = request) => runCheck(env, time, { fetch: override, now: () => time }),
  }
}

test('disabled delivery still records failures and recovery; duplicate runs do not count twice', async () => {
  const m = await monitor()
  try {
    m.setReady(false)
    await m.check()
    await m.duplicate()
    assert.equal((await m.state()).failures, 1)
    await m.check()
    assert.equal((await m.state()).unavailable, 0)
    await m.check()
    assert.equal((await m.state()).unavailable, 1)
    assert.equal(m.alerts.length, 0)
    m.setReady(true)
    await m.check()
    assert.equal((await m.state()).failures, 0)
    assert.equal((await m.state()).unavailable, 0)
    assert.ok((await m.state()).last_ok_at)
  } finally { await m.runtime.dispose() }
})

test('one outage alert after three failures and one recovery alert; no repeated healthy alerts', async () => {
  const m = await monitor()
  try {
    m.env.ALERTS_ENABLED = 'true'
    m.setReady(false)
    await m.check(); await m.check(); await m.check(); await m.check()
    assert.deepEqual(m.alerts.map(alert => alert.event), ['outage'])
    m.setReady(true)
    await m.check(); await m.check()
    assert.deepEqual(m.alerts.map(alert => alert.event), ['outage', 'recovery'])
    assert.equal((await m.state()).notified_down, 0)
    assert.equal(JSON.stringify(m.alerts).includes('private-token'), false)
    assert.equal(await m.db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 0)
  } finally { await m.runtime.dispose() }
})

test('failed alerts retry on the next scheduled check with fixed errors and retained delivery state', async () => {
  const m = await monitor()
  try {
    m.env.ALERTS_ENABLED = 'true'
    m.setReady(false)
    await m.check(); await m.check()
    m.setDelivery(500)
    await assert.rejects(m.check(), { message: 'Monitoring execution failed.' })
    assert.equal((await m.state()).notified_down, 0)
    assert.ok((await m.state()).last_alert_error_at)
    m.setDelivery(204)
    await m.check()
    assert.equal((await m.state()).notified_down, 1)
    m.setReady(true)
    m.setDelivery(500)
    await assert.rejects(m.check(), { message: 'Monitoring execution failed.' })
    assert.equal((await m.state()).notified_down, 1)
    m.setDelivery(204)
    await m.check()
    assert.equal((await m.state()).notified_down, 0)
  } finally { await m.runtime.dispose() }
})

test('overlapping checks share a lease and expired leases can be reclaimed', async () => {
  const m = await monitor()
  try {
    let release, entered
    const started = new Promise(resolve => { entered = resolve })
    const blocked = new Promise(resolve => { release = resolve })
    const first = m.check(async () => { entered(); await blocked; return Response.json({ status: 'ready', service: 'xasha' }) })
    await started
    let secondRequests = 0
    await m.duplicate(async () => { secondRequests++; return new Response(null, { status: 503 }) })
    assert.equal(secondRequests, 0)
    release(); await first
    assert.equal((await m.state()).failures, 0)
    await m.db.prepare('UPDATE monitor_state SET lease_id = ?1, lease_until = 1').bind('expired').run()
    m.setReady(false)
    await m.check()
    assert.equal((await m.state()).failures, 1)
  } finally { await m.runtime.dispose() }
})

test('network errors, malformed and oversized status responses count as failures; paused checks do nothing', async () => {
  const m = await monitor()
  try {
    m.setProbeError(true)
    await m.check()
    assert.equal((await m.state()).last_http_status, null)
    await m.check(async () => new Response('not-json'))
    await m.check(async () => new Response(' '.repeat(1025)))
    assert.equal((await m.state()).unavailable, 1)
    const previous = await m.state()
    m.env.MONITOR_MODE = 'paused'
    await m.check(async () => { throw new Error('Should not fetch') })
    assert.deepEqual(await m.state(), previous)
  } finally { await m.runtime.dispose() }
})

test('webhook credentials never follow redirects and invalid transport is rejected', async () => {
  const m = await monitor()
  try {
    m.env.ALERTS_ENABLED = 'true'
    m.env.WEBHOOK_FORMAT = 'discord'
    m.setReady(false)
    await m.check(); await m.check()
    const requests = []
    await m.check(async (url, init) => {
      requests.push(init)
      return m.request(url, init)
    })
    assert.equal(requests.every(request => request.redirect === 'error'), true)
    assert.deepEqual(m.alerts[0].allowed_mentions, { parse: [] })
    m.setReady(true)
    m.env.ALERT_WEBHOOK_URL = 'http://alerts.invalid/private-token'
    await assert.rejects(m.check(), { message: 'Monitoring execution failed.' })
    assert.equal(m.alerts.length, 1)
  } finally { await m.runtime.dispose() }
})
