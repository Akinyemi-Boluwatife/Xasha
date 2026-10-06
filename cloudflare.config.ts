import { bindings, defineConfig, triggers } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

export default defineConfig({
  worker: {
    name: 'xasha-dev',
    compatibilityDate: '2026-10-01',
    entrypoint,
    triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
    env: {
      ALLOWED_ORIGINS: bindings.text('[]'),
      SERVICE_MODE: bindings.text('active'),
      CREATE_LIMITER: bindings.rateLimit({ namespace: '736201', simple: { limit: 10, period: 60 } }),
      MAX_SECRETS: bindings.text('10000'),
      MAX_STORAGE_BYTES: bindings.text('52428800'),
      DB: bindings.d1({
        id: '6da3fc49-e7da-467e-a86a-ab041b5cec71',
        name: 'xasha-dev',
      }),
    },
  },
})
