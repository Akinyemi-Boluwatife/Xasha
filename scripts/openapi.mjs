import { readFile, writeFile } from 'node:fs/promises'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

const check = process.argv.includes('--check')
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: '.cloudflare/output/v0/workers/default/bundle/index.js',
  compatibilityDate: '2026-10-01',
}))
try {
  // Generate from the actual Worker routes without a database or remote requests.
  const response = await runtime.dispatchFetch('https://generation.invalid/openapi.json')
  if (response.status !== 200) throw new Error('OpenAPI generation failed.')
  const document = await response.json()
  const generated = JSON.stringify(document, null, 2) + '\n'
  if (check) {
    if (await readFile('docs/openapi.json', 'utf8') !== generated)
      throw new Error('OpenAPI snapshot is outdated. Run npm run openapi:generate and commit docs/openapi.json.')
    console.log('OpenAPI snapshot matches the registered route schemas.')
  } else {
    await writeFile('docs/openapi.json', generated)
    console.log('Generated docs/openapi.json from the registered route schemas.')
  }
} finally {
  await runtime.dispose()
}
