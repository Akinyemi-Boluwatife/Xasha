export const monitorConfiguration = {
  workerName: 'xasha-monitor',
  databaseName: 'xasha-monitor',
  databaseId: '4bd1fa80-cb30-4a60-af4f-9d27b09a501d',
  readinessUrl: 'https://api.xasha.site/ready',
  mode: 'active',
  alertsEnabled: false,
  webhookFormat: 'json',
} as const
