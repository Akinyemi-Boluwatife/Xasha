
## Cloudflare

- When interacting with Cloudflare, use the `cf` CLI unless the project has a Wrangler configuration file.

## Cloudflare documentation and best practices

- Whenever writing or modifying Cloudflare-related backend code, infrastructure configuration, or CLI commands, consult the relevant current official online documentation at https://developers.cloudflare.com/ and https://developers.cloudflare.com/cf/.
- Reference https://developers.cloudflare.com/llms-full.txt and https://developers.cloudflare.com/cf/llms-full.txt online when needed. Do not download or maintain local copies of these Cloudflare documentation files.
- Always follow current official Cloudflare best practices and verify guidance against the installed `cf` version. Treat documentation examples as reference material; retain this project's `cf` CLI requirement.

## Hono documentation and best practices

- Whenever writing or modifying Hono code, always consult the relevant sections of the local documentation in `docs/hono-llms-full.txt` and the current official online documentation at https://hono.dev/docs/.
- Always follow the official Hono best practices at https://hono.dev/docs/guides/best-practices and the guidance relevant to Cloudflare Workers at https://hono.dev/docs/getting-started/cloudflare-workers.
- Verify APIs and patterns against the installed Hono version. If the local snapshot is outdated, consult the current official documentation and refresh it from https://hono.dev/llms-full.txt when appropriate.
- Cite relevant official documentation when handing off architectural decisions.

## Project scope

- Xasha is a backend-only Hono project using Cloudflare infrastructure and D1. Do not build or modify frontend code.
- For database incidents, follow `docs/recovery.md`. Do not restore historical secret rows into a database serving Xasha; maintenance and fresh-database recovery preserve the one-time retrieval policy.
