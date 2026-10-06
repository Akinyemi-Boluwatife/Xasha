import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

const payload = { envelope: { version: 1, iv: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(17).toString('base64url') } }
const send = (runtime, origin, path = '/secrets', body = payload) => runtime.dispatchFetch(`https://test.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('blocked origins cannot create, consume or delete; same-origin and non-browser clients still work', async () => {
  const { runtime, db } = await setup()
  try {
    for (const origin of ['https://evil.invalid', 'null', 'https://test.invalid.evil.invalid']) {
      const response = await send(runtime, origin)
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 0)
    const response = await send(runtime, 'https://test.invalid')
    assert.equal(response.status, 201)
    const secret = await response.json()
    assert.equal((await send(runtime, 'https://evil.invalid', `/secrets/${secret.id}/consume`, undefined)).status, 403)
    assert.equal((await send(runtime, 'https://evil.invalid', `/secrets/${secret.id}/delete`, { deleteToken: secret.deleteToken })).status, 403)
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 1)
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${secret.id}/consume`, { method: 'POST' })).status, 200)
  } finally { await runtime.dispose() }
})

test('allowlisted browser preflight is side-effect free and errors retain CORS headers', async () => {
  const { runtime, db } = await setup({ allowedOrigins: '["https://client.invalid"]' })
  try {
    const preflight = headers => runtime.dispatchFetch('https://test.invalid/secrets', {
      method: 'OPTIONS', headers: { Origin: 'https://client.invalid', 'Access-Control-Request-Method': 'POST', ...headers },
    })
    const response = await preflight({ 'Access-Control-Request-Headers': 'content-type' })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://client.invalid')
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
    assert.equal((await preflight({ 'Access-Control-Request-Headers': 'authorization' })).status, 403)
    assert.equal((await preflight({ 'Access-Control-Request-Method': 'DELETE' })).status, 403)
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 0)
    const error = await send(runtime, 'https://client.invalid', '/secrets', {})
    assert.equal(error.status, 400)
    assert.equal(error.headers.get('access-control-allow-origin'), 'https://client.invalid')
    assert.ok(error.headers.get('vary').includes('Origin'))
    assert.equal((await send(runtime, 'https://client.invalid')).status, 201)
    assert.equal((await send(runtime, 'https://client.invalid.evil.invalid')).status, 403)
  } finally { await runtime.dispose() }
})

test('invalid origin configuration fails closed', async () => {
  for (const allowedOrigins of ['["*"]', '["https://client.invalid/path"]', 'not-json']) {
    const { runtime, db } = await setup({ allowedOrigins })
    try {
      assert.equal((await send(runtime)).status, 503)
      assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 0)
    } finally { await runtime.dispose() }
  }
})

test('maintenance mode blocks mutations and cleanup but keeps health available', async () => {
  const { runtime, db } = await setup({ serviceMode: 'maintenance' })
  try {
    const id = 'A'.repeat(32)
    await db.prepare('INSERT INTO secrets VALUES (?1, 1, ?2, ?3, ?4, 1, 2)').bind(id, payload.envelope.iv, payload.envelope.ciphertext, 'a'.repeat(64)).run()
    for (const path of ['/secrets', `/secrets/${id}/consume`, `/secrets/${id}/delete`]) {
      assert.equal((await send(runtime, undefined, path)).status, 503)
    }
    await (await runtime.getWorker()).scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() })
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 1)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/health')).status, 200)
  } finally { await runtime.dispose() }
})
