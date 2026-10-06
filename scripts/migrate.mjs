import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { environments } from '../config/environments.ts'

const mode = process.argv[2]
if (mode !== 'development' && mode !== 'production') {
  throw new Error('Select development or production explicitly.')
}
const extra = process.argv.slice(3)
if (extra.some(arg => arg !== '--local') || (mode === 'production' && extra.length)) {
  throw new Error('Only development migrations support --local.')
}
const result = spawnSync('cf', [
  'd1', 'migrations', 'apply', environments[mode].databaseId,
  '--mode', mode, '--dir', 'migrations', ...extra,
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' })
if (result.error) throw new Error('Could not start cf. Ensure it is installed and authenticated.')
process.exit(result.status ?? 1)
