import { bindings, defineConfig, defineWorker, triggers } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }
import { environments } from './config/environments.ts'
import { monitorConfiguration } from './config/monitor.ts'
import * as monitorEntrypoint from './monitor/index.ts' with { type: 'cf-worker' }

export default defineConfig(({ mode }) => {
  if (mode === 'monitor') return {
    accountId: '63eca1c8f22792777a93b6ddd9e18534',
    worker: defineWorker({
      name: monitorConfiguration.workerName,
      compatibilityDate: '2026-10-01',
      entrypoint: monitorEntrypoint,
      workersDev: false,
      previewUrls: false,
      logpush: false,
      observability: { enabled: false },
      triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
      env: {
        MONITOR_DB: bindings.d1({ id: monitorConfiguration.databaseId, name: monitorConfiguration.databaseName }),
        READINESS_URL: bindings.text(monitorConfiguration.readinessUrl),
        MONITOR_MODE: bindings.text(monitorConfiguration.mode),
        ALERTS_ENABLED: bindings.text(String(monitorConfiguration.alertsEnabled)),
        WEBHOOK_FORMAT: bindings.text(monitorConfiguration.webhookFormat),
        ...(monitorConfiguration.alertsEnabled ? { ALERT_WEBHOOK_URL: bindings.secret() } : {}),
      },
    }),
  }
  if (mode !== undefined && mode !== 'development' && mode !== 'production') {
    throw new Error('Select development, production, or monitor mode.')
  }
  const environment = environments[mode ?? 'development']
  return {
    accountId: '63eca1c8f22792777a93b6ddd9e18534',
    worker: defineWorker({
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
    }),
  }
})
