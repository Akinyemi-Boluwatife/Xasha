# Xasha

Backend-only one-time secret sharing service built with Hono on Cloudflare Workers and D1.

Production is deployed at [xasha.boluakinyemi500.workers.dev](https://xasha.boluakinyemi500.workers.dev/health). The service has no accounts or login. This repository provides the API; share-link pages, encryption, and reveal controls belong to the future browser client.

For integrations, start with the [developer guide](docs/developers.md), [OpenAPI specification](docs/openapi.json), and [encryption example](examples/encryption.mjs). Third-party browser origins currently require explicit approval in configuration; Node.js and command-line clients can use the hosted API directly. Original project code is [ISC licensed](LICENSE); upstream documentation attribution is in [NOTICE](NOTICE).

To self-host, replace the operator's Cloudflare account and database identifiers before running remote migration or deployment commands. See the developer guide for the complete setup. Publishing or cloning the source does not grant access to the operator's resources.

## How Xasha works

1. The client encrypts text before sending it to the API. The backend receives an encrypted envelope, never the plaintext or decryption key.
2. Xasha stores the envelope and returns a random secret reference, expiry, and a separate private deletion token. The token is returned once; only its hash is stored.
3. The client constructs a share link with the decryption key in the URL fragment. Opening a link does not retrieve content; an explicit consume request retrieves and atomically removes the envelope.
4. Only one request can consume a secret. Expired, consumed, deleted, and invalid references receive the same unavailable response.
5. The private deletion token can delete an available secret. If deletion and consumption race, the first successful operation wins.

Consumption is final even if delivery or client decryption fails. One-time retrieval does not prevent a recipient from copying or saving the revealed text. Provider recovery history can retain deleted records; see the [recovery runbook](docs/recovery.md).

| Product setting | Value |
| --- | --- |
| Content | Text encrypted by the client |
| Text allowance | 32 KiB of UTF-8 text; client enforces plaintext size |
| Default expiry | 24 hours |
| Expiry choices | 1 hour, 24 hours, or 7 days |
| Encryption envelope | AES-256-GCM, with a fresh client-generated key and IV |

## Development

Use Node.js 22.18 or newer and npm. Run commands inside WSL, where the authenticated `cf` CLI is installed.

```sh
npm ci
npm run dev
npm run typecheck
npm run build
```

`GET /health` returns `{ "status": "ok", "service": "xasha" }`. This is a liveness endpoint; it does not query D1.

`cloudflare.config.ts` selects settings from `config/environments.ts` using the explicit CLI mode. Local development simulates D1; the remote database is used by deployed Workers. The Vite configuration bundles backend code only.

```sh
npm run deploy
```

This deploys the development Worker. The default build, deploy, and migration commands target development. Use the npm scripts to select the intended environment explicitly.

## Hosting

`api.xasha.site` is the planned production custom hostname. Cloudflare activation is pending; the workers.dev URLs below remain the verified endpoints.

Both environments use Cloudflare Workers and separate D1 databases, with no custom domain.

| Environment | API URL | D1 database | Rate-limit namespace |
| --- | --- | --- | --- |
| Development | https://xasha-dev.boluakinyemi500.workers.dev | xasha-dev | 736201 |
| Production | https://xasha.boluakinyemi500.workers.dev | xasha-production | 736202 |

`GET /health` is available in both environments. No custom domain or frontend origin is configured.

To migrate and deploy production:

```sh
npm run typecheck
npm test
npm run db:migrate:production
npm run deploy:production
node tests/live-smoke.mjs https://xasha.boluakinyemi500.workers.dev
```

The live smoke test creates disposable synthetic secrets and verifies retrieval and deletion. It consumes those secrets. `npm run build:production` builds production without deploying.

Worker request logging, persisted traces, Logpush, and preview URLs are disabled in the project configuration. Application code does not log secret payloads, keys, tokens, or complete links. Cloudflare's platform retention, including D1 recovery history, is described in the recovery runbook.

## Cloudflare Workers Builds

Production uses Cloudflare Workers Builds connected to [the GitHub repository](https://github.com/Akinyemi-Boluwatife/Xasha). Pushes to `main` run checks and automatically deploy production after those checks pass. Preview builds are disabled; other branches do not deploy through this connection. GitHub Actions is not required.

Build settings are managed in Cloudflare under **Workers & Pages → xasha → Settings → Build**, or through `cf builds`. The repository defines the commands; the repository connection, branch filters, and deployment credentials are stored in Cloudflare.

| Build setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run ci:check` |
| Deploy command | `npm run ci:deploy` |
| Node.js | `24.18.0`, selected by `.node-version` |
| Preview builds | Disabled |

`ci:check` checks TypeScript, runs isolated integration tests, and builds and validates both the monitor and production API with deployment dry runs. `ci:deploy` applies production D1 migrations, uploads the prebuilt production API bundle using `cf`, and verifies the live API with disposable synthetic secrets. The monitor has a separate Workers Builds connection on the same repository, using `ci:monitor:check` and `ci:monitor:deploy`. Its build validates and deploys only the monitor bundle after running the shared tests. A failed check or migration stops that Worker's deployment. A failed live check marks the API build failed after deployment; it does not roll back code or database changes. Use the [recovery runbook](docs/recovery.md) for incidents.

Workers Builds uses its configured Cloudflare build token. That token must permit Worker deployment and D1 migrations in Xasha's account. No Cloudflare token is stored in GitHub Actions. Build credentials are accessible to build scripts, so only trusted changes should be merged to `main`.

Inspect and retry builds in the Cloudflare dashboard, or use `cf builds list`, `cf builds get`, `cf builds logs get`, and `cf builds create`. See their `--help` output for required Worker tags, trigger IDs, and build IDs. Before maintenance or database recovery, pause automatic builds so a new push cannot reactivate production unexpectedly.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build image and Node selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), and [Cloudflare CLI in CI](https://developers.cloudflare.com/cf/ci/).

## Secret API

Creation, atomic one-time consumption, and token-authorized deletion are implemented; see [the API contract](docs/api-contract.md). Consumed or deleted rows are removed immediately. Expiry is enforced during each mutation even before cleanup.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check service liveness |
| `GET` | `/ready` | Check active service mode and read-only D1 readiness |
| `POST` | `/secrets` | Store an encrypted envelope and return its reference, deletion token, and expiry |
| `POST` | `/secrets/{id}/consume` | Retrieve and consume an available envelope atomically |
| `POST` | `/secrets/{id}/delete` | Delete using the private token supplied in the JSON body |

Secret routes have no version prefix. Responses use `Cache-Control: no-store`. There is no endpoint to list secrets or retrieve content without consuming it. The [API contract](docs/api-contract.md) describes JSON formats, envelope validation, status codes, and integration requirements.

Apply versioned migrations before deploying against a new database:

```sh
npm run db:migrate
```

This targets the remote **development** database. To exercise migrations locally, use `npm run db:migrate:dev -- --local`. Integration tests use their own isolated, ephemeral D1 database.

```sh
npm test
```

The tests build the Worker and exercise encryption interoperability, concurrent consumption, deletion races, expiry, validation, and request limits in the Workers/D1 simulator.

Browser-origin controls and maintenance mode are implemented. Recovery uses the [fresh-database runbook](docs/recovery.md); there is no automatic restore detection or consume retry.

## Monitoring

The separate `xasha-monitor` Worker checks production `/ready` every five minutes and records an outage after three consecutive failures. It uses its own D1 database and has no public URL. **Webhook delivery is disabled until a destination is configured.** Outage and recovery delivery support is implemented and tested.

Cloudflare provides aggregate Workers and D1 metrics without request logging. See [the monitoring guide](docs/monitoring.md) for status inspection, webhook setup, pausing checks, and limitations. A monitor hosted on Cloudflare cannot reliably detect an outage that also stops Cloudflare's monitoring infrastructure.

## Browser access

`allowedOrigins` in `config/environments.ts` supplies the `ALLOWED_ORIGINS` JSON array for each environment. It defaults to `[]`, allowing same-origin browser requests and clients without an `Origin` header, such as command-line tools. No frontend address has been chosen yet.

When a frontend address is known, configure its exact origin, for example `["https://app.example"]`, then rebuild and deploy. An origin contains a scheme, hostname, and optional port, with no path or trailing slash. Wildcards and `null` origins are not accepted. Configuration mistakes fail closed with `503`.

Disallowed browser origins receive `403` before any secret mutation. Allowed preflights permit `POST` and `Content-Type`, expose `Retry-After`, and do not use cookies or credentials. CORS applies to `/secrets` and `/secrets/*`; it is a browser integration policy, not authentication. Anyone with a secret reference can still make a direct API request; decryption requires the complete share link. Vite's automatic CORS is disabled so local development uses the same policy.

`serviceMode` in `config/environments.ts` supplies `SERVICE_MODE` and defaults to `active`. Set the affected environment to `maintenance` and deploy with its matching command to block secret operations and pause scheduled cleanup while keeping health available. Follow [the recovery runbook](docs/recovery.md) before any database recovery action.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Start the local development Worker |
| `npm run typecheck` | Check TypeScript |
| `npm test` | Build and run isolated Workers/D1 integration tests |
| `npm run build` | Build development |
| `npm run build:production` | Build production |
| `npm run build:monitor` | Build the monitoring Worker |
| `npm run db:migrate:dev` | Apply migrations to remote development D1 |
| `npm run db:migrate:dev -- --local` | Apply migrations to local development D1 |
| `npm run db:migrate:production` | Apply migrations to production D1 |
| `npm run db:migrate:monitor` | Apply migrations to the monitor's separate D1 database |
| `npm run deploy:dev` | Deploy development |
| `npm run deploy:production` | Deploy production |
| `npm run deploy:monitor` | Deploy the scheduled monitoring Worker |
| `npm run ci:check` | Run the Workers Builds checks and validate production without uploading |
| `npm run ci:deploy` | Migrate, deploy the prebuilt production bundle, and verify the live API |
| `npm run ci:monitor:check` | Run shared tests and validate the monitoring bundle |
| `npm run ci:monitor:deploy` | Migrate monitoring state and deploy its prebuilt bundle |

`npm run deploy` and `npm run db:migrate` are development aliases. Production commands are explicit.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | App composition, shared policies, and routes mounted with `app.route()` |
| `src/routes/` | Feature-based Hono sub-apps: `secrets.ts` groups all secret routes; `status.ts` groups health and readiness |
| `src/secrets/` | Secret actions grouped in `actions.ts`, validation, and shared responses |
| `src/status/` | Read-only readiness checks |
| `src/middleware/` | Request policy, service mode, and creation rate limiting |
| `src/http/` | Shared error responses and method handling |
| `src/types.ts` | Shared Worker bindings and envelope types |
| `src/scheduled.ts` | Scheduled cleanup handler |
| `src/protocol.ts` | Bounded body parsing, encoding, token hashing, and safe database errors |
| `src/browser-policy.ts` | Browser-origin controls |
| `src/cleanup.ts` | Bounded expiry cleanup |
| `monitor/` | Check orchestration, separate readiness probe and alert actions, and monitoring schema |
| `config/monitor.ts` | Monitoring resources, target, pause mode, and delivery settings |
| `config/environments.ts` | Separate development and production resources, browser origins, and service mode |
| `cloudflare.config.ts` | Worker bindings, limits, privacy settings, and cleanup schedule |
| `migrations/` | Versioned D1 schema changes |
| `scripts/migrate.mjs` | Environment-specific migration command |
| `tests/` | Integration tests and opt-in live smoke check |

Route handlers stay beside their path definitions to preserve Hono's parameter inference. They validate HTTP input and call the action modules; database mutations live in `src/secrets/`. Common policies are registered before sub-apps. The scheduled cleanup handler is a Worker event handler, separate from HTTP routes. This follows [Hono's larger application guidance](https://hono.dev/docs/guides/best-practices#building-a-larger-application).

## Operational safeguards

Defaults for both environments in `cloudflare.config.ts`:

| Setting | Value |
| --- | --- |
| Creation attempts | 10 per IP per 60 seconds per Cloudflare location |
| Stored records | 10,000 |
| Stored payload budget | 50 MiB |
| Expiry cleanup | Every 5 minutes, up to 10,000 expired records per run |

These are initial operational defaults, configurable separately from the agreed product size and expiry settings. Rebuild and deploy after changing them.

Creation attempts, including invalid requests, count toward throttling. Excess attempts return `429` with `Retry-After: 60`; retrieval and deletion stay available. `CF-Connecting-IP` supplies the bucket key on Cloudflare; missing addresses share a fallback bucket. Shared networks share a bucket. No IP addresses are stored in D1 or application logs. Cloudflare's limiter is approximate and local to each Cloudflare location, not an exact global quota. Namespaces `736201` and `736202` are reserved for Xasha's development and production creation limiters; do not reuse them for unrelated bindings.

The storage budget counts encoded ciphertext plus 128 bytes of fixed envelope, reference, hash, and timestamp data per record. It includes expired records awaiting cleanup. It does not measure physical SQLite pages, indexes, database metadata, or Cloudflare recovery copies. Count and payload caps are enforced together in the insertion statement using transactional D1 counters. Capacity exhaustion returns `503` without creating a secret; retrieval, deletion, and cleanup free capacity atomically. Migration `0002` initializes the counters from existing records.

Cleanup deletes expired rows in batches of 500 and leaves available secrets untouched. Backlogs beyond one run's bound are handled by later runs. Retrieval enforces expiry regardless of cleanup progress. Cleanup failure marks the scheduled execution failed using a fixed error without sensitive database details.

References: [Cloudflare rate-limit behavior](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Environment selection follows [cf project modes](https://developers.cloudflare.com/cf/projects/) and [programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/).

## Documentation

- Product requirements: [PRD.md](PRD.md)
- Developer integration and self-hosting: [docs/developers.md](docs/developers.md)
- OpenAPI specification: [docs/openapi.json](docs/openapi.json)
- Secret API contract: [docs/api-contract.md](docs/api-contract.md)
- Recovery runbook: [docs/recovery.md](docs/recovery.md)
- Monitoring guide: [docs/monitoring.md](docs/monitoring.md)
- Browser CORS guidance: https://hono.dev/docs/middleware/builtin/cors
- Local Hono reference: `docs/hono-llms-full.txt`
- https://hono.dev/docs/getting-started/cloudflare-workers
- https://hono.dev/docs/guides/best-practices
- https://developers.cloudflare.com/d1/worker-api/
- Cloudflare full reference (online only): https://developers.cloudflare.com/llms-full.txt
- Cloudflare CLI reference (online only): https://developers.cloudflare.com/cf/llms-full.txt

Cloudflare commands use `cf`, with no Wrangler configuration.
