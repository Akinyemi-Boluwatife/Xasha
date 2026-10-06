// Explicit opt-in: creates and consumes synthetic secrets on the given service.
import assert from 'node:assert/strict'

const base = process.argv[2]
if (!base) throw new Error('Usage: node tests/live-smoke.mjs <service-url>')
const send = (path, body) => fetch(new URL(path, base), {
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  signal: AbortSignal.timeout(15000),
})
const envelope = { version: 1, iv: Buffer.alloc(12).toString('base64url'), ciphertext: Buffer.alloc(17).toString('base64url') }
const create = async () => {
  const response = await send('/secrets', { envelope, expiresIn: 3600 })
  assert.equal(response.status, 201)
  return response.json()
}
const secret = await create()
const blocked = await fetch(new URL(`/secrets/${secret.id}/consume`, base), {
  method: 'POST', headers: { Origin: 'https://blocked.invalid' }, signal: AbortSignal.timeout(15000),
})
assert.equal(blocked.status, 403)
assert.equal(blocked.headers.get('access-control-allow-origin'), null)
const responses = await Promise.all(Array.from({ length: 6 }, () => send(`/secrets/${secret.id}/consume`)))
assert.equal(responses.filter(response => response.status === 200).length, 1)
assert.equal(responses.filter(response => response.status === 404).length, 5)
assert.deepEqual((await responses.find(response => response.status === 200).json()).envelope, envelope)
assert.ok(responses.every(response => response.headers.get('cache-control') === 'no-store'))
const deleted = await create()
assert.equal((await send(`/secrets/${deleted.id}/delete`, { deleteToken: deleted.deleteToken })).status, 204)
assert.equal((await send(`/secrets/${deleted.id}/consume`)).status, 404)
console.log('Live smoke passed: origin rejection, atomic consumption, deletion, and no-store responses.')
