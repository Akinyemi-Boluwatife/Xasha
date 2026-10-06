import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptText, decryptText } from '../examples/encryption.mjs'
import { setup } from './runtime.mjs'

test('documented encryption example interoperates with the API and rejects tampering', async () => {
  const { runtime } = await setup()
  try {
    const text = 'Xasha interoperability 🔐'
    const { envelope, keyFragment } = await encryptText(text)
    const created = await runtime.dispatchFetch('https://test.invalid/secrets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope }),
    })
    assert.equal(created.status, 201)
    const { id } = await created.json()
    const response = await runtime.dispatchFetch(`https://test.invalid/secrets/${id}/consume`, { method: 'POST' })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(await decryptText(result.envelope, keyFragment), text)
    const other = await encryptText(text)
    assert.notEqual(other.keyFragment, keyFragment)
    await assert.rejects(decryptText(result.envelope, other.keyFragment))
    const modified = Buffer.from(result.envelope.ciphertext, 'base64url')
    modified[0] ^= 1
    await assert.rejects(decryptText({ ...result.envelope, ciphertext: modified.toString('base64url') }, keyFragment))
    await assert.rejects(encryptText(''))
    await assert.rejects(encryptText('🔐'.repeat(8193)))
    const maximum = await encryptText('a'.repeat(32768))
    assert.equal(Buffer.from(maximum.envelope.ciphertext, 'base64url').length, 32784)
    assert.equal((await runtime.dispatchFetch(`https://test.invalid/secrets/${id}/consume`, { method: 'POST' })).status, 404)
  } finally { await runtime.dispose() }
})
