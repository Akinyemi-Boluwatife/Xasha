# Integrating with Xasha

Xasha is an HTTP API with no accounts or API keys. Use any HTTP client; Hono RPC is optional. Hosted base URL: `https://api.xasha.site`.

Use [OpenAPI](openapi.json) for schemas and [the API contract](api-contract.md) for protocol details. Share-link and delete-confirmation pages belong to a separate client, which this backend does not serve.

## Encrypt and create

[The encryption example](../examples/encryption.mjs) exports `encryptText()` and `decryptText()`. It works with Web Crypto in Node.js 22.18+ and compatible secure browser contexts. It has no network, logging or storage side effects. It is an interoperability example, not a published SDK.

Envelope version 1 uses AES-256-GCM, a fresh random 32-byte key and 12-byte IV per secret, a 128-bit authentication tag appended to ciphertext, no additional authenticated data, and canonical unpadded base64url. Enforce 1–32768 UTF-8 **bytes**, not characters. Never send plaintext or the key to the API.

```js
import { encryptText, decryptText } from './examples/encryption.mjs'

const api = 'https://api.xasha.site'
const { envelope, keyFragment } = await encryptText('Example secret')
const response = await fetch(`${api}/secrets`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ envelope, expiresIn: 86400 }),
  cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
})
if (!response.ok) throw new Error(`Creation failed (${response.status}).`)
const { id, deleteToken, expiresAt } = await response.json()
// Keep keyFragment and deleteToken private. Never log them.
```

Expiry seconds: `3600`, `86400` (default when omitted), or `604800`. Maximum uncompressed JSON request: 49152 bytes. Compression and unknown fields are rejected. Creation is not idempotent: retrying an uncertain response can create another secret. Clear the sender's form only after successful creation and preserve the returned links.

## Construct client links

Your client could use `https://your-client.example/s/{id}#{keyFragment}` and a separate private `https://your-client.example/delete/{id}#{deleteToken}`. These are proposed client routes, not working hosted Xasha pages. Fragments are not sent in HTTP requests, but scripts can read them. Keep complete links out of analytics and error reporting.

Describe the experience as **encrypted in your browser**. The service delivering browser code remains part of the trust model; do not claim it can never access secrets. Node integrations encrypt in the calling process.

## Reveal on an explicit action

Only call consume after clicking Reveal. Page loading and link previews must not call it. Send no body:

```js
// Run only when the recipient chooses Reveal.
const revealed = await fetch(`${api}/secrets/${id}/consume`, {
  method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
  signal: AbortSignal.timeout(15000),
})
if (!revealed.ok) throw new Error(`Reveal failed (${revealed.status}).`)
const result = await revealed.json()
const text = await decryptText(result.envelope, keyFragment)
// Render safely as text content; keep revealed text only in memory.
```

**Disable automatic consume retries in HTTP clients, SDKs, proxies and service workers.** Timeouts, server errors, aborted requests and decryption failures may occur after irreversible consumption. One-time retrieval does not prevent copying, saving or screenshots.

Used, expired, deleted, missing and malformed references all return `404 SECRET_UNAVAILABLE`: “This secret is no longer available.” Missing keys and decrypt failures are separate client errors; the server cannot verify the key.

## Delete with confirmation

Opening a delete link must show confirmation. Only clicking Delete sends:

```js
const deleted = await fetch(`${api}/secrets/${id}/delete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deleteToken }), cache: 'no-store', credentials: 'omit', redirect: 'error',
  signal: AbortSignal.timeout(15000),
})
// 204: this request deleted the secret.
// 404: unavailable secret or incorrect well-formed token.
```

Never put the token in an API URL. It authorizes deletion only. Delete and consume race atomically; whichever succeeds first wins. Deletion cannot recall released content. A retry can return 404 after an earlier successful deletion. There is no recovery of a lost delete link.

## Browser access and hosted limits

The hosted secret API supports any browser origin using `Access-Control-Allow-Origin: *`, including local development clients. Use `credentials: 'omit'`; the API has no cookies or credentialed CORS. Node.js and command-line clients are supported too. Health/readiness are operational endpoints without cross-origin browser headers.

Self-hosted operators can choose `["*"]` for public access or exact origins in `config/environments.ts`; development defaults to same-origin only. Allowed preflights permit POST and Content-Type without credentials and never mutate secrets. Unsupported requested headers or methods receive 403. CORS controls browser access, not authentication or abuse.

Creation is limited to approximately 10 attempts per IP per minute **per Cloudflare location**. Shared networks share a bucket; invalid attempts count. A 429 includes Retry-After: 60. Shared storage is capped at 10000 records and 50 MiB logical payload, including expired rows awaiting cleanup. Capacity exhaustion returns 503. Retrieval and deletion do not use the creation limiter.

`GET /health` and `GET /ready` are read-only probes. Hosted access is best effort with no availability guarantee; this is not durable storage.

## Self-host

1. Clone and run `npm ci` with the Node version in `.node-version`.
2. Authenticate `cf` to **your own** Cloudflare account (`cf auth --help`).
3. Create separate development and production D1 databases (`cf d1 --help`). Replace accountId in `cloudflare.config.ts`, and database IDs, names, Worker names and dedicated rate-limit namespaces in `config/environments.ts`. Checked-in identifiers belong to the original operator and grant no access.
4. For monitoring, also replace resources in `config/monitor.ts` and point readinessUrl to your API. Alerts are disabled by default.
5. Choose public or restricted browser origins, then run `npm run typecheck` and `npm test`.
6. Apply migrations before deployment: `npm run db:migrate:dev`, then `npm run deploy:dev`. Use explicit production commands after replacing production resources.
7. Connect your repository to Workers Builds using README's commands. Connections and credentials are not included in a clone. Replace the live-smoke URL in package.json for your API.

Local migrations: `npm run db:migrate:dev -- --local`. `npm run dev` prints the local URL and uses simulated D1. Isolated tests require no production credentials. Store credentials in Cloudflare secret bindings, never Git. Follow [fresh-database recovery](recovery.md); serving restored historical rows can release a consumed secret again.

## References

- [Web Crypto encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
- [OpenAPI 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
