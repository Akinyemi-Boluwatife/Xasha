# Xasha

Backend-only one-time secret sharing service built with Hono on Cloudflare Workers and D1.

## Development

Use Node.js 22 or newer and npm. Run commands inside WSL, where the authenticated `cf` CLI is installed.

```sh
npm ci
npm run dev
npm run typecheck
npm run build
```

`GET /health` returns `{ "status": "ok", "service": "xasha" }`. This is a liveness endpoint; it does not query D1.

`cloudflare.config.ts` configures the development Worker `xasha-dev` and the `DB` binding to the development D1 database. Local development simulates D1; the remote database is used by deployed Workers. The Vite configuration bundles backend code only.

```sh
npm run deploy
```

This deploys the development Worker. Production resources are not configured.

## Secret API

Creation, atomic one-time consumption, and token-authorized deletion are implemented; see [the API contract](docs/api-contract.md). Consumed or deleted rows are removed immediately. Expiry is enforced during each mutation even before cleanup.

Apply versioned migrations before deploying against a new database:

```sh
npm run db:migrate
```

This targets the remote **development** database. To exercise migrations locally with the CLI, use `cf d1 migrations apply 6da3fc49-e7da-467e-a86a-ab041b5cec71 --local`. Integration tests use their own isolated, ephemeral D1 database.

```sh
npm test
```

The tests build the Worker and exercise encryption interoperability, concurrent consumption, deletion races, expiry, validation, and request limits in the Workers/D1 simulator.

Browser-origin controls and maintenance mode are implemented. Recovery uses the [fresh-database runbook](docs/recovery.md); there is no automatic restore detection or consume retry.

## Browser access

`ALLOWED_ORIGINS` is a JSON array of exact website origins in `cloudflare.config.ts`. It defaults to `[]`, allowing same-origin browser requests and clients without an `Origin` header, such as command-line tools. No frontend address has been chosen yet.

When a frontend address is known, configure its exact origin, for example `["https://app.example"]`, then rebuild and deploy. An origin contains a scheme, hostname, and optional port, with no path or trailing slash. Wildcards and `null` origins are not accepted. Configuration mistakes fail closed with `503`.

Disallowed browser origins receive `403` before any secret mutation. Allowed preflights permit `POST` and `Content-Type`, expose `Retry-After`, and do not use cookies or credentials. CORS applies to `/v1/*`; it is a browser integration policy, not authentication. Anyone with a secret reference can still make a direct API request; decryption requires the complete share link. Vite's automatic CORS is disabled so local development uses the same policy.

`SERVICE_MODE` defaults to `active`. Set it to `maintenance` and deploy to block secret operations and pause scheduled cleanup while keeping health available. Follow [the recovery runbook](docs/recovery.md) before any database recovery action.

## Operational safeguards

Development defaults in `cloudflare.config.ts`:

| Setting | Value |
| --- | --- |
| Creation attempts | 10 per IP per 60 seconds per Cloudflare location |
| Stored records | 10,000 |
| Stored payload budget | 50 MiB |
| Expiry cleanup | Every 5 minutes, up to 10,000 expired records per run |

These are initial operational defaults, configurable separately from the agreed product size and expiry settings. Rebuild and deploy after changing them.

Creation attempts, including invalid requests, count toward throttling. Excess attempts return `429` with `Retry-After: 60`; retrieval and deletion stay available. `CF-Connecting-IP` supplies the bucket key on Cloudflare; missing addresses share a fallback bucket. Shared networks share a bucket. No IP addresses are stored in D1 or application logs. Cloudflare's limiter is approximate and local to each Cloudflare location, not an exact global quota. Namespace `736201` is reserved here for Xasha's development creation limiter; do not reuse it for unrelated bindings.

The storage budget counts encoded ciphertext plus 128 bytes of fixed envelope, reference, hash, and timestamp data per record. It includes expired records awaiting cleanup. It does not measure physical SQLite pages, indexes, database metadata, or Cloudflare recovery copies. Count and payload caps are enforced together in the insertion statement using transactional D1 counters. Capacity exhaustion returns `503` without creating a secret; retrieval, deletion, and cleanup free capacity atomically. Migration `0002` initializes the counters from existing records.

Cleanup deletes expired rows in batches of 500 and leaves available secrets untouched. Backlogs beyond one run's bound are handled by later runs. Retrieval enforces expiry regardless of cleanup progress. Cleanup failure marks the scheduled execution failed using a fixed error without sensitive database details.

References: [Cloudflare rate-limit behavior](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Documentation

- Product requirements: [PRD.md](PRD.md)
- Secret API contract: [docs/api-contract.md](docs/api-contract.md)
- Recovery runbook: [docs/recovery.md](docs/recovery.md)
- Browser CORS guidance: https://hono.dev/docs/middleware/builtin/cors
- Local Hono reference: `docs/hono-llms-full.txt`
- https://hono.dev/docs/getting-started/cloudflare-workers
- https://hono.dev/docs/guides/best-practices
- https://developers.cloudflare.com/d1/worker-api/
- Cloudflare full reference (online only): https://developers.cloudflare.com/llms-full.txt
- Cloudflare CLI reference (online only): https://developers.cloudflare.com/cf/llms-full.txt

Cloudflare commands use `cf`, with no Wrangler configuration.
