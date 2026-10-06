// Run from the project root: node examples/test-api.mjs
// Creates two synthetic secrets; no real secrets, keys, or tokens are logged.
import assert from "node:assert/strict";
import { encryptText, decryptText } from "./encryption.mjs";

const api = new URL(process.argv[2] ?? "https://api.xasha.site");
const pending = new Map();
const post = (path, body) =>
  fetch(new URL(path, api), {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });

async function create(envelope) {
  const response = await post("/secrets", { envelope, expiresIn: 3600 });
  if (response.status !== 201) {
    await response.body?.cancel();
    throw new Error(`Creation failed (HTTP ${response.status}).`);
  }
  const secret = await response.json();
  pending.set(secret.id, secret.deleteToken);
  return secret;
}

try {
  const original = "Xasha test: hello 🔐";
  const { envelope, keyFragment } = await encryptText(original);
  const secret = await create(envelope);
  console.log("PASS: encrypted locally and created a secret.");

  // Consume exactly once; never retry after a timeout or network failure.
  const revealed = await post(`/secrets/${secret.id}/consume`);
  assert.equal(revealed.status, 200, "First retrieval must succeed.");
  pending.delete(secret.id);
  const result = await revealed.json();
  assert.equal(await decryptText(result.envelope, keyFragment), original);
  console.log("PASS: retrieved and decrypted the original text.");

  const second = await post(`/secrets/${secret.id}/consume`);
  assert.equal(second.status, 404, "A consumed secret must be unavailable.");
  await second.body?.cancel();
  console.log("PASS: second retrieval rejected.");

  const disposable = await create(
    (await encryptText("Deletion test")).envelope,
  );
  const deleted = await post(`/secrets/${disposable.id}/delete`, {
    deleteToken: disposable.deleteToken,
  });
  assert.equal(deleted.status, 204, "Deletion must succeed.");
  pending.delete(disposable.id);
  const unavailable = await post(`/secrets/${disposable.id}/consume`);
  assert.equal(
    unavailable.status,
    404,
    "A deleted secret must be unavailable.",
  );
  await unavailable.body?.cancel();
  console.log("PASS: private deletion prevents retrieval.");
} catch (error) {
  console.error(`Test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Best-effort removal if a test fails; otherwise unused records expire in an hour.
  await Promise.allSettled(
    [...pending].map(async ([id, deleteToken]) => {
      const response = await post(`/secrets/${id}/delete`, { deleteToken });
      await response.body?.cancel();
    }),
  );
}
