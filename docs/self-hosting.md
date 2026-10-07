# Self-hosting Xasha

To use the hosted API, follow the [integration guide](developers.md). These steps are only for running your own backend.


1. Clone and run `npm ci` with the Node version in `.node-version`.
2. Authenticate `cf` to **your own** Cloudflare account (`cf auth --help`).
3. Create separate development and production D1 databases (`cf d1 --help`). Replace accountId in `cloudflare.config.ts`, and database IDs, names, Worker names and dedicated rate-limit namespaces in `config/environments.ts`. Checked-in identifiers belong to the original operator and grant no access.
4. For monitoring, also replace resources in `config/monitor.ts` and point readinessUrl to your API. Alerts are disabled by default.
5. Choose public or restricted browser origins, then run `npm run typecheck` and `npm test`.
6. Apply migrations before deployment: `npm run db:migrate:dev`, then `npm run deploy:dev`. Use explicit production commands after replacing production resources.
7. Connect your repository to Workers Builds: API build command `npm run ci:check`, deploy command `npm run ci:deploy`; monitor build command `npm run ci:monitor:check`, deploy command `npm run ci:monitor:deploy`. Both check commands block known high/critical dependency audit findings before testing. Connections and credentials are not included in a clone. Replace the live-smoke URL in package.json for your API.

Local migrations: `npm run db:migrate:dev -- --local`. `npm run dev` prints the local URL and uses simulated D1. Isolated tests require no production credentials. Store credentials in Cloudflare secret bindings, never Git. Follow [fresh-database recovery](recovery.md); serving restored historical rows can release a consumed secret again.

