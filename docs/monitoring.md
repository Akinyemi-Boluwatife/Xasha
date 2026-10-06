# Xasha production monitoring

## Readiness and liveness

`GET /health` confirms that the API Worker responds. `GET /ready` also checks that service mode is active, configured limits are valid, D1 responds, the secrets table exists, and the singleton storage counters are readable. Ready returns `200` with `{ "status": "ready", "service": "xasha" }`; otherwise it returns `503` with `{ "status": "unavailable", "service": "xasha" }`. Both use `Cache-Control: no-store`.

Readiness checks read schema and aggregate metadata only. They never create, retrieve, delete, or inspect secret content. The public response exposes no counts or database diagnostics. It is a read-only dependency check, not proof that every write path, quota, or encryption flow works. Deployments also run the synthetic lifecycle smoke test.

## Scheduled monitor

The separate `xasha-monitor` Worker runs every five minutes and requests the production `/ready` URL with a ten-second timeout. Network failures, non-200 responses, malformed status JSON, unexpected service/status, and oversized status bodies count as failures. It follows no redirects.

After three consecutive failed checks, it records production as unavailable. A successful readiness check clears the failure count. Detection normally takes roughly 10–15 minutes from the start of an outage, plus scheduling delays. Cron scheduling is not an exact timing guarantee.

The monitor has no public workers.dev address, preview URL, or manual HTTP trigger. It is deployed using the `monitor` CLI mode from the same repository. It binds only the separate `xasha-monitor` D1 database, not the secret database.

One metadata row stores the capped failure count, unavailable flag, check timestamps, last HTTP status, delivery state, and a short-lived lease. Atomic lease claims and recorded schedule timestamps prevent concurrent, duplicate, or out-of-order invocations from counting twice. Leases expire after two minutes so a crashed execution can be replaced.

Inspect state with an aggregate-only command:

```sh
cf d1 query 4bd1fa80-cb30-4a60-af4f-9d27b09a501d --mode monitor --sql 'SELECT failures, unavailable, last_checked_at, last_ok_at, last_http_status, last_alert_at, last_alert_error_at FROM monitor_state WHERE singleton = 1'
```

Timestamps are Unix milliseconds. A null `last_checked_at` means no check has completed. A stale timestamp means the monitor itself needs investigation, even if the last check was successful. Inspect the monitor's invocation outcomes in Cloudflare Workers metrics for scheduler or database failures.

## Webhook alerts

Alert delivery is currently **disabled**, as requested. Readiness polling and state recording run without a webhook. There are no outage or recovery notifications until a destination is configured.

When a destination is chosen:

1. Create a webhook in the chosen notification service.
2. Store its HTTPS URL as the `ALERT_WEBHOOK_URL` secret on `xasha-monitor` using Cloudflare's dashboard or the installed `cf` secret commands. Do not commit it, put it in build variables, or paste it into logs. `cf workers secrets update --help` documents the installed CLI's input options.
3. Set `alertsEnabled: true` and `webhookFormat` in `config/monitor.ts`. Supported formats are `json`, `slack`, and `discord`.
4. Commit and push the configuration so Workers Builds redeploys the monitor. Secret bindings are declared when alerts are enabled; ensure the secret exists before enabling them.

The generic JSON payload contains `service`, `event` (`outage` or `recovery`), `checkedAt`, and a fixed message. Slack uses `text`; Discord uses `content` with automatic mentions disabled. No secret references, encrypted payloads, deletion tokens, user IPs, or webhook URLs are sent.

The monitor sends one outage alert after three failures. It sends a recovery alert after readiness succeeds if an outage alert was successfully delivered. Persistent failures do not generate repeated successful outage alerts. Failed deliveries are retried on later scheduled checks while the condition remains applicable. If an outage resolves before its alert is delivered, no stale outage or unmatched recovery alert is sent. Enabling delivery during an existing outage reports the current outage; it does not replay past incidents.

Webhook requests time out after ten seconds and do not follow redirects. Delivery failures record an error timestamp and fail the scheduled invocation with a fixed message. Delivery is at least once: a lost webhook response or a failure saving the acknowledgement can cause a duplicate. There is no exactly-once guarantee or reminder escalation.

## Metrics and operating procedures

Use Cloudflare's built-in Workers metrics for invocations, execution outcomes, CPU time, and duration. Use D1 metrics for rows read/written, database size, and usage. These aggregate dashboards do not require enabling request logs or storing complete secret links. Application-generated `503` responses are not necessarily classified as runtime exceptions by Workers metrics; the readiness monitor covers its dependency check specifically. Automatic error-rate, capacity, and billing alerts are not configured by this change.

Before planned downtime, set `mode: 'paused'` in `config/monitor.ts` and deploy the monitor. Paused checks leave the recorded state unchanged. Restore `active` afterward. Coordinate this with the [recovery runbook](recovery.md) and pause automatic builds during recovery. Monitor deployment failure does not roll back an already successful API deployment; inspect the failed build and fix forward.

The monitor and its state both run on Cloudflare. A wider Cloudflare outage may stop checks or notifications too. Independent external uptime monitoring is needed to detect that failure mode. No external uptime service has been configured.

## Deployment

Workers Builds checks both API and monitor bundles. It migrates both databases, deploys the validated production API bundle, checks the live API, then builds and deploys the monitor. Manual monitor deployment uses:

```sh
npm run db:migrate:monitor
npm run deploy:monitor
```

The databases are pre-created account resources. Neither command creates or changes secret database contents through monitoring.

## Official references

- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Programmatic cf configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
- [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)
