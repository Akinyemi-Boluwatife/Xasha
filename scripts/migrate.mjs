import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { environments } from '../config/environments.ts'
import { monitorConfiguration } from '../config/monitor.ts'

const mode = process.argv[2]
if (!['development', 'production', 'monitor'].includes(mode)) {
  throw new Error('Select development, production, or monitor explicitly.')
}
const extra = process.argv.slice(3)
if (extra.some(arg => arg !== '--local') || (mode !== 'development' && extra.length)) {
  throw new Error('Only development migrations support --local.')
}
const result = spawnSync('cf', [
  'd1', 'migrations', 'apply', (mode === 'monitor' ? monitorConfiguration : environments[mode]).databaseId,
  '--mode', mode, '--dir', mode === 'monitor' ? 'monitor/migrations' : 'migrations', ...extra,
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' })
if (result.error) throw new Error('Could not start cf. Ensure it is installed and authenticated.')
process.exit(result.status ?? 1)
