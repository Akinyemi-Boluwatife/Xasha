export const environments = {
  development: {
    workerName: 'xasha-dev',
    domains: [] as string[],
    databaseName: 'xasha-dev',
    databaseId: '6da3fc49-e7da-467e-a86a-ab041b5cec71',
    rateLimitNamespace: '736201',
    allowedOrigins: [] as string[],
    serviceMode: 'active',
  },
  production: {
    workerName: 'xasha',
    domains: ['api.xasha.site'],
    databaseName: 'xasha-production',
    databaseId: '5cb06d05-2d95-43a5-9a95-2b32c5a449fb',
    rateLimitNamespace: '736202',
    allowedOrigins: ['*'] as string[],
    serviceMode: 'active',
  },
} as const
