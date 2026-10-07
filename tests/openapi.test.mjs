import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setup } from './runtime.mjs'

const envelope = { version: 1, iv: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(17).toString('base64url') }
const post = (runtime, path, body) => runtime.dispatchFetch(`https://test.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const invalidResponse = async response => {
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } })
}

test('generated OpenAPI matches the snapshot and public documentation never touches secrets or action budgets', async () => {
  const { runtime, db } = await setup({ rateLimit: 1, accessRateLimit: 1, readinessRateLimit: 1 })
  try {
    const secret = await (await post(runtime, '/secrets', { envelope })).json()
    const response = await runtime.dispatchFetch('https://test.invalid/openapi.json', { headers: { Origin: 'https://docs.invalid' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
    const document = await response.json()
    assert.deepEqual(document, JSON.parse(await readFile('docs/openapi.json', 'utf8')))
    assert.deepEqual(Object.keys(document.paths).sort(), ['/health', '/ready', '/secrets', '/secrets/{id}/consume', '/secrets/{id}/delete'].sort())
    assert.equal(document.paths['/secrets'].post.requestBody.required, true)
    assert.equal(document.components.schemas.CreateRequest.additionalProperties, false)
    assert.equal(document.components.schemas.Envelope.additionalProperties, false)
    assert.equal(document.components.schemas.CreateRequest.properties.expiresIn.default, 86400)
    assert.equal(document.paths['/secrets/{id}/consume'].post.requestBody, undefined)
    assert.equal(JSON.stringify(document).includes(secret.id), false)
    assert.equal(JSON.stringify(document).includes(secret.deleteToken), false)
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 1)
    const head = await runtime.dispatchFetch('https://test.invalid/openapi.json', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal((await runtime.dispatchFetch('https://test.invalid/openapi.json', { method: 'OPTIONS', headers: { Origin: 'https://docs.invalid', 'Access-Control-Request-Method': 'GET' } })).status, 204)
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${secret.id}/consume`, { method: 'POST' })).status, 200)
    assert.equal((await runtime.dispatchFetch('https://test.invalid/ready')).status, 200)
    await db.prepare('DROP TABLE secrets').run()
    assert.equal((await runtime.dispatchFetch('https://test.invalid/openapi.json')).status, 200)
  } finally { await runtime.dispose() }
})

test('Zod migration preserves strict envelopes, defaults, fixed errors, and invalid-ID/body precedence', async () => {
  const { runtime, db } = await setup()
  try {
    for (const body of [null, [], 'private text', { envelope, plaintext: 'private text' }, { envelope, key: 'private key' },
      { envelope: { ...envelope, extra: true } }, { envelope: { ...envelope, version: '1' } },
      { envelope, expiresIn: 0 }, { envelope, expiresIn: '86400' }, { envelope, expiresIn: null },
      { envelope: { ...envelope, ciphertext: 'AB' } }, { envelope: { ...envelope, ciphertext: Buffer.alloc(16).toString('base64url') } },
    ]) await invalidResponse(await post(runtime, '/secrets', body))
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 0)
    const secret = await (await post(runtime, '/secrets', { envelope })).json()
    const row = await db.prepare('SELECT created_at, expires_at FROM secrets WHERE id = ?').bind(secret.id).first()
    assert.equal(row.expires_at - row.created_at, 86400000)
    await invalidResponse(await post(runtime, '/secrets/invalid/delete', {}))
    await invalidResponse(await post(runtime, '/secrets/invalid/delete', { deleteToken: secret.deleteToken, key: 'private key' }))
    const invalidId = await post(runtime, '/secrets/invalid/delete', { deleteToken: secret.deleteToken })
    assert.equal(invalidId.status, 404)
    assert.equal((await invalidId.json()).error.code, 'DELETE_UNAVAILABLE')
    await invalidResponse(await post(runtime, '/secrets/invalid/consume', {}))
    const missing = await runtime.dispatchFetch('https://test.invalid/secrets/invalid/consume', { method: 'POST' })
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'SECRET_UNAVAILABLE')
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 1)
  } finally { await runtime.dispose() }
})

test('bounded parsing precedes Zod and rejects invalid UTF-8, malformed JSON, and oversized streams', async () => {
  const { runtime, db } = await setup()
  try {
    for (const body of [new Uint8Array([0xff]), '{', '']) {
      await invalidResponse(await runtime.dispatchFetch('https://test.invalid/secrets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }))
    }
    const response = await runtime.dispatchFetch('https://test.invalid/secrets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, duplex: 'half',
      body: new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(32768));
        controller.enqueue(new Uint8Array(16385));
        controller.close();
      } }),
    })
    assert.equal(response.status, 413)
    assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE')
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 0)
  } finally { await runtime.dispose() }
})
