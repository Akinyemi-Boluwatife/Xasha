import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

test('secret lifecycle using the Workers runtime and D1', async () => {
  const { runtime, db } = await setup()
  try {
    const request = (path, method = 'POST', body) => runtime.dispatchFetch(`https://test.invalid${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const text = 'Xasha secret: 🔐'
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
    const envelope = { version: 1, iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(encrypted).toString('base64url') }
    const create = async (extra = {}) => {
      const response = await request('/v1/secrets', 'POST', { envelope, ...extra })
      assert.equal(response.status, 201)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return response.json()
    }
    const secret = await create()
    assert.equal(secret.id.length, 32)
    assert.equal(secret.deleteToken.length, 43)
    const row = await db.prepare('SELECT * FROM secrets WHERE id = ?').bind(secret.id).first()
    assert.equal(row.delete_token_hash.length, 64)
    assert.notEqual(row.delete_token_hash, secret.deleteToken)
    assert.equal(row.expires_at - row.created_at, 86400000)
    for (const action of ['consume', 'delete']) {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const response = await request(`/v1/secrets/${secret.id}/${action}`, method)
        assert.equal(response.status, method === 'OPTIONS' ? 204 : 405)
      }
    }
    const responses = await Promise.all(Array.from({ length: 12 }, () => request(`/v1/secrets/${secret.id}/consume`)))
    assert.equal(responses.filter(response => response.status === 200).length, 1)
    assert.equal(responses.filter(response => response.status === 404).length, 11)
    const content = await responses.find(response => response.status === 200).json()
    assert.deepEqual(content.envelope, envelope)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, Buffer.from(content.envelope.ciphertext, 'base64url'))
    assert.equal(new TextDecoder().decode(decrypted), text)
    assert.equal((await request(`/v1/secrets/${secret.id}/consume`)).status, 404)

    const deleted = await create()
    assert.equal((await request(`/v1/secrets/${deleted.id}/consume`, 'POST', { key: 'forbidden' })).status, 400)
    assert.equal((await request(`/v1/secrets/${deleted.id}/delete`, 'POST', { deleteToken: 'A'.repeat(43) })).status, 404)
    assert.equal((await request(`/v1/secrets/${deleted.id}/delete`, 'POST', { deleteToken: deleted.deleteToken })).status, 204)
    assert.equal((await request(`/v1/secrets/${deleted.id}/delete`, 'POST', { deleteToken: deleted.deleteToken })).status, 404)
    const deletedResult = await request(`/v1/secrets/${deleted.id}/consume`)
    const unavailable = await deletedResult.json()
    for (const id of ['invalid', 'A'.repeat(32), secret.id]) {
      const response = await request(`/v1/secrets/${id}/consume`)
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), unavailable)
    }
    const expired = await create({ expiresIn: 3600 })
    await db.prepare('UPDATE secrets SET created_at = 1, expires_at = 2 WHERE id = ?').bind(expired.id).run()
    assert.deepEqual(await (await request(`/v1/secrets/${expired.id}/consume`)).json(), unavailable)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM secrets WHERE id = ?').bind(expired.id).first()).count, 1)

    for (let i = 0; i < 10; i++) {
      const raced = await create()
      const [consume, deletion] = await Promise.all([
        request(`/v1/secrets/${raced.id}/consume`),
        request(`/v1/secrets/${raced.id}/delete`, 'POST', { deleteToken: raced.deleteToken }),
      ])
      assert.ok((consume.status === 200 && deletion.status === 404) || (consume.status === 404 && deletion.status === 204))
    }
    for (const body of [{ envelope, key: 'forbidden' }, { envelope, expiresIn: null }, { envelope, expiresIn: 60 }, { envelope: { ...envelope, iv: 'bad' } }]) {
      assert.equal((await request('/v1/secrets', 'POST', body)).status, 400)
    }
    const maxCipher = Buffer.alloc(32784).toString('base64url')
    assert.equal((await request('/v1/secrets', 'POST', { envelope: { ...envelope, ciphertext: maxCipher }, expiresIn: 604800 })).status, 201)
    assert.equal((await request('/v1/secrets', 'POST', { envelope: { ...envelope, ciphertext: Buffer.alloc(32785).toString('base64url') } })).status, 413)
    // Streaming request without Content-Length must also be bounded.
    const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(49153)); controller.close() } })
    const response = await runtime.dispatchFetch('https://test.invalid/v1/secrets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversized, duplex: 'half',
    })
    assert.equal(response.status, 413)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await runtime.dispatchFetch('https://test.invalid/v1/secrets', { method: 'POST', body: '{}' })).status, 415)
    assert.equal((await request('/health', 'GET')).status, 200)
    await db.prepare('DROP TABLE secrets').run()
    const failure = await request(`/v1/secrets/${'A'.repeat(32)}/consume`)
    assert.equal(failure.status, 503)
    assert.equal((await failure.json()).error.code, 'SERVICE_UNAVAILABLE')
  } finally { await runtime.dispose() }
})
