# Integrating with Xasha

Use **`https://api.xasha.site`** from your own app. You do not need an account, API key, SDK, or your own backend deployment.

The planned website at [xasha.site](https://xasha.site) will include readable documentation and an API playground using this same public API. Until it launches, this guide and the terminal examples below are available on GitHub. See the [website plan](frontend-plan.md) for the proposed layout.

Your app encrypts and decrypts the text, builds the share links, and asks the user to confirm reveal or deletion. Xasha stores the encrypted text, enforces expiry, and allows one retrieval. This repository does not serve browser share-link pages.

## 1. Add the encryption helper

Copy [encryption.mjs](../examples/encryption.mjs) into your app. It works in secure browser contexts (HTTPS or localhost) and Node.js 22.18+. No additional npm package is needed for the hosted API.

The snippets below belong in your app's integration module, beside that helper:

```js
import { encryptText, decryptText } from './encryption.mjs'

const api = 'https://api.xasha.site'
const options = {
  cache: 'no-store',
  credentials: 'omit',
  redirect: 'error',
}
```

These examples target browsers and Node.js. Cloudflare Workers clients should use `redirect: 'manual'` and reject redirect responses; see [Workers request guidance](https://developers.cloudflare.com/workers/runtime-apis/request/).

## 2. Encrypt and create a secret

Call this when the sender chooses **Create secret link**:

```js
async function createSecret(text, expiresIn = 86400) {
  const { envelope, keyFragment } = await encryptText(text)
  const response = await fetch(`${api}/secrets`, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope, expiresIn }),
    signal: AbortSignal.timeout(15000),
  })
  if (response.status !== 201) throw new Error(`Creation failed (${response.status}).`)
  const { id, deleteToken, expiresAt } = await response.json()
  return { id, keyFragment, deleteToken, expiresAt }
}
```

Only the encrypted `envelope` and expiry go to Xasha. The returned object combines the server's ID and deletion token with the encryption key your app generated locally.

- Expiry choices: `3600` (1 hour), `86400` (24 hours, default), or `604800` (7 days).
- Text limit: **32 KiB of UTF-8 text**. The helper checks bytes, not characters.
- Clear the sender's input after successful creation. Keep the returned links available for copying.
- Do not automatically retry creation after an uncertain response; it could create another secret.

## 3. Build the share and private delete links

Use **your app's address**, not the API address:

```js
const secret = await createSecret('Example private note')
const clientOrigin = 'https://your-app.example' // Replace with your app's origin.

const shareLink = new URL(`/s/${secret.id}`, clientOrigin)
shareLink.hash = secret.keyFragment

const deleteLink = new URL(`/delete/${secret.id}`, clientOrigin)
deleteLink.hash = secret.deleteToken

// Show shareLink.href to the sender, with a copy button.
// Show deleteLink.href separately as a private deletion option.
// Do not log these values or send them to analytics.
```

Your app must handle `/s/:id` and `/delete/:id`. These are suggested client routes, not pages hosted by Xasha. The `#fragment` stays in the client and is not sent in HTTP requests. The sender shares the share link and keeps the private delete link.

## 4. Reveal and decrypt once

On your share page, read the ID from the path and the key from the fragment (`url.hash.slice(1)`). Validate that both are present before enabling Reveal. **Do not request the secret when the page loads.**

Call this only after the recipient chooses **Reveal secret**:

```js
async function revealSecret(id, keyFragment) {
  const response = await fetch(`${api}/secrets/${encodeURIComponent(id)}/consume`, {
    ...options,
    method: 'POST', // No request body; never send the encryption key.
    signal: AbortSignal.timeout(15000),
  })
  if (response.status === 404) throw new Error('This secret is no longer available.')
  if (response.status !== 200) throw new Error(`Retrieval failed (${response.status}).`)
  const { envelope } = await response.json()
  return decryptText(envelope, keyFragment)
}
```

Xasha removes the secret as it retrieves the encrypted text. Display the returned text safely as text content, keep it in memory, and provide a copy button. Do not save it in localStorage or other browser storage.

Disable Reveal while the request is running. **Never automatically retry consumption**, including on timeouts or server errors: the secret might already have been consumed. A lost response or failed decryption cannot restore it. A wrong key can still consume the secret, so keep the share link intact.

## 5. Delete an unread secret

On your private delete page, read the ID from the path and the deletion token from the fragment. Opening the page does nothing; ask the sender to confirm **Delete secret** before calling:

```js
async function deleteSecret(id, deleteToken) {
  const response = await fetch(`${api}/secrets/${encodeURIComponent(id)}/delete`, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteToken }),
    signal: AbortSignal.timeout(15000),
  })
  if (response.status === 404) throw new Error('Could not delete: unavailable secret or invalid delete code.')
  if (response.status !== 204) throw new Error(`Deletion failed (${response.status}).`)
}
```

The deletion token goes in the request body, never the API URL. It cannot decrypt the secret. Deletion cannot undo a completed retrieval, and lost links cannot be recovered.

## Handle failures

| Result | What your app should do |
| --- | --- |
| `400`, `413`, or `415` | Check the payload, text size, and JSON content type. |
| `404` on reveal | Show “This secret is no longer available.” |
| `404` on delete | Explain that deletion was not possible; the secret may be unavailable or the token invalid. |
| `429` | Show “Too many requests. Try again later.” Respect `Retry-After` (currently 60 seconds). |
| `500`, `503`, or a network timeout | Show a temporary failure. Do not automatically retry a reveal request. |
| Decryption failure | Explain that the key or encrypted data could not be verified; retrieval has already consumed the secret. |

The hosted API accepts any browser origin without cookies or credentialed requests. Creation allows approximately 10 attempts per IP per minute; reveal and deletion share 120. Limits apply per Cloudflare location, and shared networks share budgets. See the [API contract](api-contract.md) for every response and limit.

## Try it without building an app

Clone the repository and, with Node.js 22.18+, run:

```sh
node examples/interactive.mjs
```

In terminal 1, choose **1**, type dummy text, and copy the share code. In terminal 2, run the same command, choose **2**, paste the code, and confirm Reveal. Try revealing again to see that it is unavailable. To test deletion, create another secret and choose **3** with its private delete code. These are terminal codes, not browser links.

For an automated live check:

```sh
node examples/test-api.mjs
```

Both tools use the hosted API and create real, disposable test secrets. Use dummy text; the interactive tool displays codes and revealed text in your terminal.

## Further details

- [API contract](api-contract.md) — request formats, limits, and error codes.
- [OpenAPI specification](openapi.json) — machine-readable API definition.
- [Self-hosting](self-hosting.md) — run your own backend on Cloudflare.
- [Security safeguards](security.md) and [recovery policy](recovery.md).
- [Web Crypto encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt).

Describe browser integrations as **“encrypted in your browser.”** Anyone with the complete share link can reveal the text, and recipients can copy or save it. The code delivered to the browser remains part of the trust model. Hosted access is best effort, with no availability guarantee.
