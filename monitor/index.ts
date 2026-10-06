import { runCheck, type MonitorBindings } from './check.ts'

export default {
  fetch: () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } }),
  scheduled: async (event: ScheduledController, env: MonitorBindings) => {
    await runCheck(env, event.scheduledTime)
  },
} satisfies ExportedHandler<MonitorBindings>
