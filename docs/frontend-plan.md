# Xasha website plan

Status: planned. The frontend will be built in a separate project; this repository remains backend-only.

## Where everything lives

| Location | Purpose |
| --- | --- |
| GitHub | Backend source, concise overview, examples, integration guide, and OpenAPI specification |
| `https://xasha.site` | Sharing interface, documentation, and an API playground |
| `https://api.xasha.site` | The existing public backend used by the website and other developers' apps |

There are two places people visit to learn or try Xasha: GitHub and the website. The API hostname serves requests, not a separate documentation website. Display the same public API base URL on GitHub, in the website documentation, and in the playground.

## Suggested website pages

- `/`: create a secret, choose an expiry, and copy its share link plus a separate private delete link.
- `/s/:id`: show Reveal before retrieving, then decrypt locally and display the text.
- `/delete/:id`: ask for confirmation before deletion.
- `/docs`: readable integration steps, endpoint reference, examples, and errors.
- `/playground`: test creation, reveal, and deletion against the public API with dummy text.

These pages are proposed and are not currently hosted. Documentation and the playground are sections of the same website; no third documentation site is needed. Site navigation should link to Docs, Playground, and GitHub.

## Documentation

Keep [the integration guide](developers.md) and [API contract](api-contract.md) in this backend repository. Route definitions and Zod schemas generate the [OpenAPI snapshot](openapi.json) and the public specification at `https://api.xasha.site/openapi.json`. Render or adapt the guides into the frontend site's `/docs` section, with links back to GitHub. Import a known revision at website build time and update/rebuild the website when API documentation changes. Documentation tools can also load the live specification using its public GET CORS headers. Avoid manually maintaining two separate endpoint definitions.

GitHub retains the concise overview and a direct integration-guide link. Once the website is live, change its README label from planned to available and add direct Docs and Playground links.

## Playground behavior

Use the existing public API at `https://api.xasha.site`; there is no separate playground backend or account system. Explain that requests affect real disposable secrets and count toward the hosted limits.

Let users enter dummy text and choose an expiry. Encrypt in the browser before creation. Show the HTTP method, endpoint, status, and encrypted request/response data separately from the local encryption key. Keep keys and private deletion tokens out of request URLs, telemetry, and persisted history. A key is displayed only as part of an explicitly requested share link or local credential control, never as an API request field.

Retrieval must wait for an explicit Reveal action and deletion for confirmation. Disable repeated clicks while an action is pending; never automatically retry retrieval. Opening a page or previewing a request must not consume a secret. Keep plaintext and credentials in memory; render revealed text as text content, not HTML.

## Hosting

Build the frontend as a separate lightweight project and deploy it to a separate Cloudflare Worker using [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/). Attach `xasha.site` as its [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Keep the current API Worker on `api.xasha.site` and its D1 binding unchanged. Use the project's `cf` CLI policy for infrastructure work.

The backend already supports public browser requests without credentials. The frontend can call it directly, encrypting and decrypting on the user's device; it does not need a proxy server or access to D1.
