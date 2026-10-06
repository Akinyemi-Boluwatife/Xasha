# Security safeguards

Xasha has implemented safeguards and integration tests; it has not undergone an independent security audit or penetration test.

## Secret protection

Clients encrypt text using AES-256-GCM with fresh random keys and IVs. The API receives ciphertext, never the plaintext or encryption key. Secret IDs use 24 cryptographically random bytes; deletion tokens use 32 random bytes and are stored only as SHA-256 hashes. Prepared SQL statements bind inputs. Atomic deletion with returned content enforces one retrieval, including concurrent requests. Expiry is checked in that same operation.

Requests are size-bounded while streaming, reject unknown fields and compressed bodies, and validate canonical encoding. Responses prohibit caching and use fixed errors without submitted data. Request logs and traces are disabled in project configuration. These controls do not prove that a caller encrypted its data correctly.

## Abuse protection

| Operation | Requests per IP per minute per Cloudflare location |
| --- | --- |
| Create | 10 |
| Reveal and delete combined, across all IDs | 120 |
| Readiness, GET and HEAD combined | 60 |

Each category has a separate rate-limit namespace. Attempts reaching an operation's limiter, including invalid IDs or bodies, consume its budget before parsing or database access. Earlier policy rejections, such as disallowed origins or compressed requests, do not. Throttled requests return `429 RATE_LIMITED`, `Retry-After: 60`, and `Cache-Control: no-store`; secret rows remain untouched. Missing or failing limiter bindings fail closed with `503`. Browser secret responses retain CORS headers. Allowed preflights do not use these budgets. Creation throttling leaves the separate reveal/delete budget available. Health performs no database work and remains unthrottled.

The key comes from Cloudflare's `CF-Connecting-IP`, never `X-Forwarded-For`. Requests without an address share a fallback bucket. IP addresses are not written to D1 or application logs. Operators must use distinct namespaces for every environment and category; this project reserves 736201/736203/736204 for development and 736202/736205/736206 for production.

Limits are [approximate and local to each Cloudflare location](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Shared networks share budgets, and distributed attackers can use multiple IPs or locations. This is not a global quota, complete DDoS protection, or a billing cap. Separate transactional storage caps limit records to 10,000 and logical payload to 50 MiB; physical database space and provider recovery copies are not included.

## Dependency checks

`npm run audit` checks all dependencies, including build tools, and fails on known high or critical findings. Both Workers Builds check commands run it before tests and deployment. Registry/advisory unavailability also stops this check; the gate does not certify that dependencies are vulnerability-free.

The `sharp` override pins 0.35.5 because the Cloudflare development toolchain otherwise selects vulnerable 0.35.4. This addresses [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and its propagated audit findings. Reassess this override when upstream dependencies adopt the patched release. The native prebuilt dependencies are recorded in the lockfile, and the patched toolchain is verified through build, test, and deployment validation.

## Remaining trust boundaries

- Anyone with the complete share code/link can decrypt the secret. Anyone with the secret ID alone can consume its ciphertext and make it unavailable, even without knowing the encryption key.
- One retrieval cannot prevent recipients copying or saving text. Response loss or failed decryption can lose a consumed secret.
- A malicious client, compromised device, or compromised browser code can expose plaintext and keys. Browser encryption does not eliminate trust in the party delivering that code.
- Removing a live row does not erase Cloudflare recovery history. Follow the [recovery runbook](recovery.md); restoring historical rows into a serving database can violate one-time retrieval.
- Webhook alerts remain disabled until the operator chooses a destination. Account 2FA, production token permissions, GitHub branch protection, and independent review require separate verification; this change does not claim they are configured.

## Implementation references

- [Hono middleware factory](https://hono.dev/docs/helpers/factory)
- [Hono application organization](https://hono.dev/docs/guides/best-practices#building-a-larger-application)
- [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
