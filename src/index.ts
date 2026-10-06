import { Hono } from 'hono'
import { ApiError, database, decodedLength, hashToken, invalid, jsonBody, object, randomToken, readBody } from './protocol'
import { cleanupExpired } from './cleanup'
import { browserPolicy } from './browser-policy'

type Bindings = {
  DB: D1Database
  CREATE_LIMITER: RateLimit
  MAX_SECRETS: string
  MAX_STORAGE_BYTES: string
  ALLOWED_ORIGINS: string
  SERVICE_MODE: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  if (c.req.header('Content-Encoding') && c.req.header('Content-Encoding') !== 'identity') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Compressed requests are unsupported.')
  }
  await next()
})

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status)
  // Do not log request paths, bodies, credentials, or database error details.
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500)
})

for (const path of ['/secrets', '/secrets/*']) {
  app.use(path, browserPolicy)
  app.use(path, async (c, next) => {
    // Fail closed for missing or invalid configuration; health remains available.
    if (c.env.SERVICE_MODE !== 'active') {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')
    }
    await next()
  })
}

const unavailable = { error: { code: 'SECRET_UNAVAILABLE', message: 'This secret is no longer available.' } }
const deleteUnavailable = { error: {
  code: 'DELETE_UNAVAILABLE',
  message: 'This secret could not be deleted. It may already be unavailable, or the delete link may be invalid.',
} }
const validId = (id: string) => /^[A-Za-z0-9_-]{32}$/.test(id)

app.post('/secrets', async (c) => {
  // Cloudflare sets this header on incoming requests. Do not use caller-supplied
  // X-Forwarded-For. Missing addresses share one conservative fallback bucket.
  const key = `create:${c.req.header('CF-Connecting-IP') || 'unknown'}`
  const allowed = await database(() => c.env.CREATE_LIMITER.limit({ key }))
  if (!allowed.success) {
    c.header('Retry-After', '60')
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many creation requests. Try again later.' } }, 429)
  }
  const body = object(await jsonBody(c.req.raw), ['envelope', 'expiresIn'])
  const envelope = object(body.envelope, ['version', 'iv', 'ciphertext'])
  if (envelope.version !== 1 || decodedLength(envelope.iv) !== 12) throw invalid()
  const length = decodedLength(envelope.ciphertext)
  if (length < 17) throw invalid()
  const expiresIn = body.expiresIn === undefined ? 86400 : body.expiresIn
  if (typeof expiresIn !== 'number' || ![3600, 86400, 604800].includes(expiresIn)) throw invalid()
  const id = randomToken(24)
  const deleteToken = randomToken(32)
  const hash = await hashToken(deleteToken)
  const now = Date.now()
  const expiresAt = now + expiresIn * 1000
  const maxSecrets = Number(c.env.MAX_SECRETS)
  const maxBytes = Number(c.env.MAX_STORAGE_BYTES)
  if (![maxSecrets, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')
  }
  // The capacity predicate and insertion are one write. Triggers update the
  // shared counter in that same transaction, including all delete paths.
  const stored = await database(() => c.env.DB.prepare(
    `INSERT INTO secrets (id, version, iv, ciphertext, delete_token_hash, created_at, expires_at)
     SELECT ?1, 1, ?2, ?3, ?4, ?5, ?6 FROM storage_usage
     WHERE singleton = 1 AND secret_count < ?7 AND payload_bytes + ?8 <= ?9`,
  ).bind(id, envelope.iv as string, envelope.ciphertext as string, hash, now, expiresAt,
    maxSecrets, (envelope.ciphertext as string).length + 128, maxBytes).run())
  if (!stored.meta.changes) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')
  return c.json({ id, deleteToken, expiresAt: new Date(expiresAt).toISOString() }, 201)
})

app.post('/secrets/:id/consume', async (c) => {
  if ((await readBody(c.req.raw)).length) throw invalid()
  const id = c.req.param('id')
  if (!validId(id)) return c.json(unavailable, 404)
  // One database statement both removes the row and returns its envelope.
  // Do not retry this operation: a lost response cannot safely be replayed.
  const result = await database(() => c.env.DB.prepare(
    'DELETE FROM secrets WHERE id = ?1 AND expires_at > ?2 RETURNING version, iv, ciphertext',
  ).bind(id, Date.now()).all<{ version: number; iv: string; ciphertext: string }>())
  const envelope = result.results[0]
  return envelope ? c.json({ envelope }) : c.json(unavailable, 404)
})

app.post('/secrets/:id/delete', async (c) => {
  const body = object(await jsonBody(c.req.raw), ['deleteToken'])
  if (typeof body.deleteToken !== 'string' || body.deleteToken.length !== 43 || decodedLength(body.deleteToken) !== 32) throw invalid()
  const id = c.req.param('id')
  if (!validId(id)) return c.json(deleteUnavailable, 404)
  const hash = await hashToken(body.deleteToken)
  const result = await database(() => c.env.DB.prepare(
    'DELETE FROM secrets WHERE id = ?1 AND delete_token_hash = ?2 AND expires_at > ?3 RETURNING id',
  ).bind(id, hash, Date.now()).all())
  return result.results.length ? c.body(null, 204) : c.json(deleteUnavailable, 404)
})

for (const path of ['/secrets', '/secrets/:id/consume', '/secrets/:id/delete']) {
  app.options(path, c => { c.header('Allow', 'POST, OPTIONS'); return c.body(null, 204) })
  app.all(path, c => {
    c.header('Allow', 'POST, OPTIONS')
    return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405)
  })
}

app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404))

app.get('/health', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ status: 'ok', service: 'xasha' })
})

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Bindings) => {
    if (env.SERVICE_MODE === 'active') await cleanupExpired(env.DB)
  },
}
