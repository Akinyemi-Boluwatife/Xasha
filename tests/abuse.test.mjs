import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

const envelope = { version: 1, iv: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(17).toString('base64url') }
const headers = { 'Content-Type': 'application/json', Origin: 'https://client.invalid', 'CF-Connecting-IP': '192.0.2.1' }
const post = (runtime, path, body, extra = {}) => runtime.dispatchFetch(`https://test.invalid${path}`, {
  method: 'POST', headers: { ...headers, ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const create = async runtime => {
  const response = await post(runtime, '/secrets', { envelope })
  assert.equal(response.status, 201)
  return response.json()
}
const checkLimited = async response => {
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '60')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } })
}

test('reveal/delete share an IP budget across IDs; malformed attempts count and throttled secrets remain available', async () => {
  const { runtime, db } = await setup({ allowedOrigins: '["*"]', accessRateLimit: 2 })
  try {
    const secret = await create(runtime)
    assert.equal((await post(runtime, `/secrets/${'a'.repeat(32)}/consume`)).status, 404)
    assert.equal((await post(runtime, `/secrets/${'b'.repeat(32)}/delete`, {})).status, 400)
    const limited = await post(runtime, `/secrets/${secret.id}/consume`, undefined, { 'X-Forwarded-For': '198.51.100.1' })
    assert.equal(limited.headers.get('access-control-allow-origin'), '*')
    assert.ok(limited.headers.get('access-control-expose-headers').toLowerCase().includes('retry-after'))
    await checkLimited(limited)
    await checkLimited(await post(runtime, `/secrets/${secret.id}/delete`, { deleteToken: secret.deleteToken }, { 'X-Forwarded-For': '198.51.100.2' }))
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 1)
    // The distinct create and readiness budgets still work after access throttling.
    const other = await create(runtime)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/ready', { headers })).status, 200)
    assert.equal((await post(runtime, `/secrets/${secret.id}/consume`, undefined, { 'CF-Connecting-IP': '192.0.2.2' })).status, 200)
    assert.equal((await post(runtime, `/secrets/${other.id}/delete`, { deleteToken: other.deleteToken }, { 'CF-Connecting-IP': '192.0.2.2' })).status, 204)
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 0)
  } finally { await runtime.dispose() }
})

test('preflight, unsupported methods and blocked origins do not exhaust the reveal budget', async () => {
  const { runtime } = await setup({ allowedOrigins: '["https://client.invalid"]', accessRateLimit: 1 })
  try {
    const secret = await create(runtime)
    for (const action of ['consume', 'delete']) {
      const url = `https://test.invalid/secrets/${secret.id}/${action}`
      assert.equal((await runtime.dispatchFetch(url, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST' } })).status, 204)
      assert.equal((await runtime.dispatchFetch(url, { headers })).status, 405)
      assert.equal((await post(runtime, `/secrets/${secret.id}/${action}`, undefined, { Origin: 'https://blocked.invalid' })).status, 403)
    }
    assert.equal((await post(runtime, `/secrets/${secret.id}/consume`)).status, 200)
  } finally { await runtime.dispose() }
})

test('readiness GET and HEAD share a budget and throttling stops database access; health remains available', async () => {
  const { runtime, db } = await setup({ readinessRateLimit: 2 })
  try {
    assert.equal((await runtime.dispatchFetch('https://test.invalid/ready', { headers })).status, 200)
    const head = await runtime.dispatchFetch('https://test.invalid/ready', { method: 'HEAD', headers })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    await db.prepare('DROP TABLE storage_usage').run()
    await checkLimited(await runtime.dispatchFetch('https://test.invalid/ready', { headers }))
    assert.equal((await runtime.dispatchFetch('https://test.invalid/health', { headers })).status, 200)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/ready', { headers: { ...headers, 'CF-Connecting-IP': '192.0.2.2' } })).status, 503)
  } finally { await runtime.dispose() }
})

test('missing limiter bindings fail closed without consuming or deleting secrets', async () => {
  const { runtime, db } = await setup({ allowedOrigins: '["*"]', accessRateLimit: null, readinessRateLimit: null })
  try {
    const secret = await create(runtime)
    for (const [action, body] of [['consume', undefined], ['delete', { deleteToken: secret.deleteToken }]]) {
      const response = await post(runtime, `/secrets/${secret.id}/${action}`, body)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('access-control-allow-origin'), '*')
      assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE')
    }
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 1)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/ready')).status, 503)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/health')).status, 200)
  } finally { await runtime.dispose() }
})
