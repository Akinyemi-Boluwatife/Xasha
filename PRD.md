# Xasha — Backend Product Requirements

Status: Draft for agreement  
Scope: Version 1, backend only  
Last updated: 6 October 2026

## Purpose

Xasha lets people share text secrets without creating accounts. A sender creates a secret, shares a link, and a recipient can retrieve it once before it expires. The sender can also delete it before retrieval using a separate private delete link.

This document describes the backend's expected behavior. It does not specify implementation, infrastructure setup, or frontend design. Requirements describe the intended product, not the current implementation status.

## Goals

- Make short-lived secret sharing available without login or registration.
- Store encrypted content without requiring plaintext or a decryption key.
- Allow at most one successful retrieval of each secret.
- Make expiry and sender-authorized deletion reliable.
- Keep the service usable while limiting abuse and resource consumption.

## Scope and boundaries

Version 1 supports creating, retrieving, expiring, and deleting encrypted text secrets. It also provides consistent error responses and basic service health information.

The client encrypts text before submitting it and decrypts it after retrieval. The backend receives and returns encrypted content. Possession of the complete share link enables the recipient to retrieve and decrypt the secret; there is no recipient identity check.

Frontend implementation, accounts, file attachments, secret editing, repeated retrieval, and account-based recovery are outside this version's scope. Encryption and decryption in the client are integration expectations, not work delivered by this backend project.

## Expected lifecycle

| State | Expected behavior |
| --- | --- |
| Available | The secret can be retrieved once or deleted, until its expiry time. |
| Retrieved | No later request can retrieve it from the service. |
| Expired | Retrieval is denied immediately, even if storage cleanup has not run. |
| Deleted | Retrieval is denied after sender-authorized deletion succeeds. |

Retrieved, expired, and deleted secrets must not become available again through ordinary service operation. Recovery procedures must account for this requirement before being adopted.

## Functional requirements

### 1. Create a secret

The sender submits encrypted content and selects a supported expiry. The backend validates the request and accepts it only within the service's size, expiry, and usage limits.

A successful creation must:

- Store the encrypted content with an expiry measured from creation.
- Return a unique reference that the client can use to construct the share link.
- Return a separate private deletion credential that the client can use to construct the delete link.
- Clearly indicate that creation succeeded and when the secret expires.

The backend must not require an account, plaintext, or a decryption key. It must not report success unless the secret has been stored successfully. Invalid requests are rejected without creating an available secret.

The deletion credential is provided at creation. There is no account-based way to recover it later.

### 2. Retrieve a secret once

Opening or previewing a share link must not consume a secret. The backend releases encrypted content only in response to an explicit retrieval action, corresponding to the recipient choosing to reveal it.

For an available, unexpired secret, the backend must:

- Allow only one request to claim its encrypted content.
- Consume the secret as part of that retrieval, before any other request can claim it.
- Return the encrypted content to the winning request.
- Reject all subsequent retrieval attempts as unavailable.

If several recipients or requests attempt retrieval simultaneously, at most one may receive the content. No separate acknowledgement from the client is required to complete consumption.

Consumption is strict: a network interruption after consumption can cause the recipient to lose the secret. Retrying must not release it again. The sender would need to create a new secret. A client decryption failure also does not restore availability.

One-time retrieval means one retrieval from Xasha. The backend cannot prevent a recipient from copying, saving, or taking a screenshot of the decrypted text.

### 3. Expire a secret

Each secret has an expiry time. At or after that time, the backend must refuse retrieval, regardless of whether the stored record has been cleaned up.

Expired content must be removed through routine cleanup. Cleanup delays must never extend availability.

### 4. Delete a secret privately

The sender can request deletion using the separate private deletion credential. That credential authorizes deletion only; it must not allow retrieval or decryption.

Opening or previewing the delete link must not delete anything. Deletion requires an explicit confirmation action from the client.

When authorized deletion succeeds, the share link becomes unavailable. An invalid deletion credential must not affect an available secret or disclose its content.

If deletion and retrieval compete for the same available secret, whichever succeeds first wins. If retrieval wins, deletion cannot recall the content already released. A later deletion response must not imply that it has done so.

Losing the private delete link means losing the ability to request early deletion. Expiry and one-time retrieval still apply.

### 5. Report outcomes consistently

For well-formed retrieval requests, used, expired, deleted, and nonexistent secrets must all produce the same unavailable outcome:

> This secret is no longer available.

Responses must not disclose which of those conditions applies or whether another person retrieved the secret.

Malformed requests, exceeded limits, and temporary service failures must have clear outcomes that clients can handle. A temporary service failure must not be falsely presented as proof that a secret is permanently unavailable.

## Privacy and service safeguards

- The backend stores encrypted content and does not require the decryption key.
- Secret content, deletion credentials, and complete capability links must not appear in application logs or analytics.
- Retrieval responses must not be cached or replayed through service-controlled caching after consumption.
- Creation traffic, accepted payload size, secret lifetime, and total storage must be bounded.
- When limits are reached, the backend must reject requests predictably and must not claim a secret was created when it was not.
- Health information should allow operators to check service availability without exposing secrets or credentials.

Product language should describe secrets as “encrypted in your browser.” It must not promise that the service can never access secrets, because the broader service supplies the client code.

## Agreed defaults

| Setting | Value | Backend expectation |
| --- | --- | --- |
| Text size | 32 KiB (32,768 UTF-8 bytes) | Define a corresponding encrypted payload limit; the backend cannot verify the plaintext length. |
| Default expiry | 24 hours | Use the agreed default when expiry is omitted. |
| Supported expiries | 1 hour, 24 hours, 7 days | Accept only approved durations. |

These defaults are agreed. The text limit counts UTF-8 bytes rather than characters; the encrypted request limit must allow for encryption and encoding overhead.

## Acceptance criteria

1. A person can create an encrypted text secret without an account and receive a share reference, deletion credential, and expiry time.
2. Creating and retrieving a secret does not require sending plaintext or a decryption key to the backend.
3. Visiting or previewing either link does not retrieve or delete the secret.
4. An explicit retrieval of an available secret returns its encrypted content once.
5. Concurrent retrieval attempts produce at most one successful content response.
6. Retrying a consumed secret, including after interrupted delivery, never returns its content again.
7. A secret cannot be retrieved at or after expiry, even before cleanup removes it.
8. Authorized deletion prevents later retrieval; an invalid deletion credential leaves availability unchanged.
9. A retrieval-versus-deletion race has a single winner, and deletion never promises to recall released content.
10. Used, expired, deleted, and nonexistent secrets have the same unavailable retrieval outcome.
11. Invalid or oversized creation requests and requests exceeding service limits are rejected without false success responses.
12. Logs and service-controlled caches do not expose or replay secret content or deletion credentials.

## Remaining product decisions

- Review initial development operational limits documented in README. Excess creation attempts receive a retryable rate-limit outcome; capacity exhaustion rejects creation without a false success response.
- Agree on deletion responses for secrets that are already unavailable, without implying recall of previously retrieved content.
- Review the recovery procedure in `docs/recovery.md`: pending secrets may be lost when recovering into an empty database, and historical rows must not be restored into service. Provider-managed recovery history has separate retention from live availability.

These decisions do not change the core promise: an encrypted secret is available until its first retrieval, expiry, or authorized deletion, whichever happens first.
