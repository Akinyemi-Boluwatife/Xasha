import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

const envelope = { version: 1, iv: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(17).toString('base64url') }
const create = runtime => runtime.dispatchFetch('https://test.invalid/secrets', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelope }),
})

test('atomic count capacity and capacity release on consumption and deletion', async () => {
  const { runtime, db } = await setup({ maxSecrets: 3 })
  try {
    const responses = await Promise.all(Array.from({ length: 10 }, () => create(runtime)))
    assert.equal(responses.filter(response => response.status === 201).length, 3)
    assert.equal(responses.filter(response => response.status === 503).length, 7)
    assert.deepEqual(await db.prepare('SELECT secret_count, payload_bytes FROM storage_usage').first(), { secret_count: 3, payload_bytes: 453 })
    const secret = await responses.find(response => response.status === 201).json()
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${secret.id}/consume`, { method: 'POST' })).status, 200)
    const next = await create(runtime)
    assert.equal(next.status, 201)
    const deleted = await next.json()
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${deleted.id}/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteToken: deleted.deleteToken }),
    })).status, 204)
    assert.deepEqual(await db.prepare('SELECT secret_count, payload_bytes FROM storage_usage').first(), { secret_count: 2, payload_bytes: 302 })
  } finally { await runtime.dispose() }
})

test('atomic byte capacity independently of record count', async () => {
  const { runtime } = await setup({ maxBytes: 301 })
  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () => create(runtime)))
    assert.equal(responses.filter(response => response.status === 201).length, 1)
    assert.equal(responses.filter(response => response.status === 503).length, 4)
  } finally { await runtime.dispose() }
})

test('creation throttling does not block retrieval or preflight', async () => {
  const { runtime, db } = await setup({ rateLimit: 2 })
  try {
    const first = await create(runtime)
    assert.equal(first.status, 201)
    const secret = await first.json()
    assert.equal((await create(runtime)).status, 201)
    const limited = await create(runtime)
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '60')
    assert.equal(limited.headers.get('cache-control'), 'no-store')
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 2)
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${secret.id}/consume`, { method: 'POST' })).status, 200)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/secrets', { method: 'OPTIONS' })).status, 204)
  } finally { await runtime.dispose() }
})

test('scheduled cleanup removes expired rows and frees capacity without touching live secrets', async () => {
  const { runtime, db } = await setup()
  try {
    const live = await (await create(runtime)).json()
    // More than one batch proves cleanup progresses beyond its first 500 rows.
    await db.batch(Array.from({ length: 501 }, (_, i) => db.prepare(
      'INSERT INTO secrets VALUES (?1, 1, ?2, ?3, ?4, 1, 2)',
    ).bind(String(i).padStart(32, '0'), envelope.iv, envelope.ciphertext, 'a'.repeat(64))))
    const worker = await runtime.getWorker()
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() })
    assert.deepEqual(await db.prepare('SELECT secret_count, payload_bytes FROM storage_usage').first(), { secret_count: 1, payload_bytes: 151 })
    assert.equal((await db.prepare('SELECT id FROM secrets').first()).id, live.id)
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() })
    assert.equal((await db.prepare('SELECT secret_count FROM storage_usage').first()).secret_count, 1)
  } finally { await runtime.dispose() }
})
