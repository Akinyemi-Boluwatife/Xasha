# Xasha

Share private text that can be retrieved once, then becomes unavailable. No accounts or login required.

Try it at [xasha.site](https://xasha.site). API documentation and a place to try API requests will be available on the website.

## Quick start

1. Open [xasha.site](https://xasha.site) and enter the text you want to share.
2. Create a secret and send its share link to the recipient. Keep the private delete link if you want to delete it before retrieval.
3. The recipient opens the link and chooses **Reveal**. After retrieval, the secret is unavailable.

## Run locally

This repository contains the Hono backend. Use Node.js **24.18.0**, as specified in `.node-version`.

```sh
git clone https://github.com/Akinyemi-Boluwatife/Xasha.git
cd Xasha
npm ci
npm run db:migrate:dev -- --local
npm run dev
```

Use the local URL printed by the dev server. Check `/health` and `/ready` to confirm the backend is running. Local development uses simulated D1 storage.

To verify changes, run `npm run typecheck` and `npm test`. For deployment to your own Cloudflare account, follow the [self-hosting guide](docs/self-hosting.md).

## How it works

1. Your app encrypts the text on the sender's device before sending it to Xasha.
2. Xasha stores the encrypted text. Your app creates a share link, keeping the encryption key in the link's fragment.
3. The recipient chooses **Reveal**. Xasha returns the encrypted text once, and the recipient's app decrypts it locally.
4. After retrieval or expiry, the secret is unavailable. The sender can also delete an unread secret using a separate private delete link.

Opening a share link alone should not reveal or consume the secret. Anyone with the complete link can reveal it, and recipients can still copy or save the text afterward.

## What you can use it for

- Sharing temporary access codes or credentials.
- Sending private notes without leaving them readable in a chat history.
- Adding one-time secret sharing to your own app or workflow.

## Features

- Text encrypted on the sender's device; the backend receives neither plaintext nor the encryption key.
- One retrieval per secret.
- Expiry options of **1 hour, 24 hours, or 7 days**, with 24 hours as the default.
- A separate private deletion option.
- API integration for browser apps and other clients.

## For developers

Visit [xasha.site](https://xasha.site) to try Xasha. API documentation and interactive API examples will be available there.

For integration details in this repository, see the [step-by-step integration guide](docs/developers.md), [API reference](docs/api-contract.md), and [OpenAPI specification](docs/openapi.json).

[ISC license](LICENSE) · [Attribution](NOTICE)
