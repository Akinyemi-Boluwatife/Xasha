# Xasha

Share private text that can be retrieved once, then becomes unavailable. No accounts or login required.

Xasha provides the backend for secret-sharing apps and developer integrations. The API is available at [api.xasha.site](https://api.xasha.site); a browser interface is not included yet.

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
- A public API for browser apps and other clients.

## For developers

Start with the [developer guide](docs/developers.md). The [API reference](docs/api-contract.md) and [OpenAPI specification](docs/openapi.json) contain integration details.

[ISC license](LICENSE) · [Attribution](NOTICE)
