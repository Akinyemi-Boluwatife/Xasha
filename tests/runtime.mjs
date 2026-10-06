import { readFile, readdir } from 'node:fs/promises'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

export async function setup({ maxSecrets = 10000, maxBytes = 52428800, rateLimit = 1000, accessRateLimit = 1000, readinessRateLimit = 1000, allowedOrigins = '[]', serviceMode = 'active' } = {}) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: '.cloudflare/output/v0/workers/default/bundle/index.js',
    compatibilityDate: '2026-10-01',
    d1Databases: { DB: 'test-secrets' },
    bindings: { MAX_SECRETS: String(maxSecrets), MAX_STORAGE_BYTES: String(maxBytes), ALLOWED_ORIGINS: allowedOrigins, SERVICE_MODE: serviceMode },
    ratelimits: {
      CREATE_LIMITER: { namespace_id: '736201', simple: { limit: rateLimit, period: 60 } },
      ...(accessRateLimit === null ? {} : { ACCESS_LIMITER: { namespace_id: '736203', simple: { limit: accessRateLimit, period: 60 } } }),
      ...(readinessRateLimit === null ? {} : { READINESS_LIMITER: { namespace_id: '736204', simple: { limit: readinessRateLimit, period: 60 } } }),
    },
  }))
  const db = await runtime.getD1Database('DB')
  try {
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
      const sql = (await readFile(`migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '')
      const statements = Array.from(sql.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g), match => match[1])
      await db.batch(statements.map(statement => db.prepare(statement)))
    }
    return { runtime, db }
  } catch (error) { await runtime.dispose(); throw error }
}
