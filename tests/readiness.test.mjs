import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

test('readiness checks metadata without consuming secrets or exposing counters', async () => {
  const { runtime, db } = await setup()
  try {
    await db.prepare('INSERT INTO secrets VALUES (?1, 1, ?2, ?3, ?4, 1, ?5)')
      .bind('A'.repeat(32), 'A'.repeat(16), 'A'.repeat(23), 'a'.repeat(64), Date.now() + 3600000).run()
    const response = await runtime.dispatchFetch('https://test.invalid/ready')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), { status: 'ready', service: 'xasha' })
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 1)
    await db.prepare('DROP TABLE storage_usage').run()
    const unavailable = await runtime.dispatchFetch('https://test.invalid/ready')
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { status: 'unavailable', service: 'xasha' })
    assert.equal((await runtime.dispatchFetch('https://test.invalid/health')).status, 200)
  } finally { await runtime.dispose() }
})

test('maintenance and invalid limits fail readiness while health remains available', async () => {
  for (const options of [{ serviceMode: 'maintenance' }, { maxSecrets: 0 }]) {
    const { runtime } = await setup(options)
    try {
      assert.equal((await runtime.dispatchFetch('https://test.invalid/ready')).status, 503)
      assert.equal((await runtime.dispatchFetch('https://test.invalid/health')).status, 200)
    } finally { await runtime.dispose() }
  }
})
