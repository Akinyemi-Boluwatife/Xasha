import { bindings, defineConfig, triggers } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }
import { environments } from './config/environments.ts'

export default defineConfig(({ mode }) => {
  if (mode !== undefined && mode !== 'development' && mode !== 'production') {
    throw new Error('Select development or production mode.')
  }
  const environment = environments[mode ?? 'development']
  return {
    accountId: '63eca1c8f22792777a93b6ddd9e18534',
    worker: {
      name: environment.workerName,
      compatibilityDate: '2026-10-01',
      entrypoint,
      workersDev: true,
      previewUrls: false,
      logpush: false,
      observability: {
        enabled: false,
        redactQueryString: true,
        logs: { enabled: false, invocationLogs: false, persist: false },
        traces: { enabled: false, persist: false },
      },
      triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
      env: {
        ALLOWED_ORIGINS: bindings.text(JSON.stringify(environment.allowedOrigins)),
        SERVICE_MODE: bindings.text(environment.serviceMode),
        CREATE_LIMITER: bindings.rateLimit({ namespace: environment.rateLimitNamespace, simple: { limit: 10, period: 60 } }),
        MAX_SECRETS: bindings.text('10000'),
        MAX_STORAGE_BYTES: bindings.text('52428800'),
        DB: bindings.d1({
          id: environment.databaseId,
          name: environment.databaseName,
        }),
      },
    },
  }
})
