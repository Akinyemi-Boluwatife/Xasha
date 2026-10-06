# Xasha recovery runbook

## Policy

Recover service availability without restoring historical secret rows into a serving database. A restored row may represent a secret that was already consumed or deleted after the restore point. D1 alone cannot reconstruct that missing history reliably.

For a database loss or uncertain integrity, the recovery procedure uses a **new empty D1 database** and the versioned schema. Existing secret links then become unavailable. Senders must create new secrets. Losing pending secrets is preferable to releasing a consumed secret again.

This is an operator procedure supported by maintenance mode, not automatic restore detection. A privileged manual Cloudflare restore can bypass the policy. No restore command or automatic database recovery is implemented by this project.

## Maintenance mode

Set the affected environment's `serviceMode` in `config/environments.ts` to `maintenance`, then run `npm run deploy:production` or `npm run deploy:dev` using the authenticated `cf` environment. This supplies `SERVICE_MODE` to the Worker. Missing or invalid values also block secret operations. The default `npm run deploy` targets development; it does not change production.

- Secret creation, consumption, and deletion return `503` for otherwise allowed requests before touching D1 or the rate limiter.
- Scheduled expiry cleanup is paused.
- Health remains available. A successful health response does not mean the secret API is active or the database is ready.
- Browser-origin checks and side-effect-free CORS preflight continue to work.

Verify a synthetic secret request returns `503`. Allow the deployment to finish and account for in-flight requests and previously deployed versions before treating traffic as stopped. If maintenance deployment cannot be verified, disable public access at Cloudflare before any database intervention. Do not expose old Worker versions or preview URLs that bypass maintenance.

## Recover after database loss or corruption

1. Enable and verify maintenance mode. Do not restore the attached database while public requests can reach it.
2. Create a new empty database with `cf d1 create --name <new-database-name> --read-replication-mode disabled`. Choose a distinct name and record the returned database ID.
3. Apply the project's migrations to that new ID with `cf d1 migrations apply <new-database-id> --mode <production-or-development> --dir migrations`.
4. Verify the new database contains no secret rows and its `storage_usage` count and byte total are both zero. Use aggregate queries only; do not export ciphertext or credentials into logs.
5. Update the affected environment's `databaseId` and `databaseName` in `config/environments.ts`. Migration scripts use this same database ID. Keep maintenance mode enabled while deploying the new binding with the matching environment's deploy command.
6. Verify maintenance still blocks the API and confirm the deployment points at the new database. Do not reconnect historical databases or import their secret rows.
7. Set `SERVICE_MODE` back to `active` and deploy. Run `node tests/live-smoke.mjs <service-url>` to verify creation, one-time consumption, and deletion with synthetic content.
8. Check an old synthetic link returns the normal unavailable outcome. Confirm the cleanup schedule and configured limits remain deployed. Record the recovery event without links, secret IDs, keys, or token values.

The procedure is documented, not executed automatically. This change does not replace or discard the current development database.

## Code or schema incidents

For a code-only issue, fix forward or deploy a compatible prior build without restoring D1. Verify it includes maintenance controls, origin policy, and the current storage schema assumptions. Do not use an older build that lacks current safeguards.

For a schema issue, pause the service and inspect schema and aggregate counters. Repair forward only if the current secret data and one-time state remain intact. If that cannot be established, use the fresh-database procedure above. Never rebuild capacity counters from historical content and then serve it.

## Retention and limits of deletion

Consumption, deletion, and expiry cleanup remove rows from the live database. They do not establish immediate erasure from Cloudflare's recovery history. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is always enabled for supported databases; its documented history window is up to 7 days on Free and 30 days on Paid. Recheck the current plan and official documentation before making retention claims.

Do not promise that a consumed secret has vanished from every provider-managed copy. The product promise concerns retrieval through Xasha. Access to the Cloudflare account and database recovery capabilities must remain restricted to authorized operators.

## References

- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Worker environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- Use `cf --help` and the installed CLI's command help for current command syntax.
