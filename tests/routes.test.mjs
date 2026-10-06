import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './runtime.mjs'

test('mounted routes preserve method restrictions, health HEAD responses, and global policies', async () => {
  const { runtime, db } = await setup()
  try {
    for (const path of ['/secrets', `/secrets/${'A'.repeat(32)}/consume`, `/secrets/${'A'.repeat(32)}/delete`]) {
      for (const method of ['GET', 'HEAD', 'PUT', 'OPTIONS']) {
        const response = await runtime.dispatchFetch(`https://test.invalid${path}`, { method })
        assert.equal(response.status, method === 'OPTIONS' ? 204 : 405)
        if (method !== 'OPTIONS') assert.equal(response.headers.get('Allow'), 'POST, OPTIONS')
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        if (method === 'HEAD') assert.equal(await response.text(), '')
      }
    }
    for (const path of ['/health', '/ready']) {
      const response = await runtime.dispatchFetch(`https://test.invalid${path}`, { method: 'HEAD' })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.equal(await response.text(), '')
    }
    const missing = await runtime.dispatchFetch('https://test.invalid/unknown')
    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Not found.' } })
    const compressed = await runtime.dispatchFetch('https://test.invalid/secrets', {
      method: 'POST', headers: { 'Content-Encoding': 'gzip' },
    })
    assert.equal(compressed.status, 415)
    assert.equal(compressed.headers.get('Cache-Control'), 'no-store')
    assert.equal(await db.prepare('SELECT secret_count FROM storage_usage').first('secret_count'), 0)
  } finally { await runtime.dispose() }
})

