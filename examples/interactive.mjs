import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { encryptText, decryptText } from "./encryption.mjs";

const api = new URL(process.argv[2] ?? "https://api.xasha.site");
if (
  api.username ||
  api.password ||
  api.search ||
  api.hash ||
  api.pathname !== "/" ||
  (api.protocol !== "https:" &&
    !(
      api.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)
    ))
) {
  throw new Error(
    "Use an HTTPS API origin, or HTTP localhost for development.",
  );
}
const terminal = createInterface({ input: stdin, output: stdout });
const ask = async (prompt) => (await terminal.question(prompt)).trim();

async function post(path, body) {
  try {
    return await fetch(new URL(path, api), {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "No response received. The operation may have completed; nothing was automatically retried.",
    );
  }
}

function parseCode(code, prefix) {
  const match = code.match(
    new RegExp(`^${prefix}:([A-Za-z0-9_-]{32})#([A-Za-z0-9_-]{43})$`),
  );
  if (
    !match ||
    Buffer.from(match[2], "base64url").toString("base64url") !== match[2]
  ) {
    throw new Error(`Paste a complete ${prefix} code.`);
  }
  return { id: match[1], credential: match[2] };
}

async function rejectResponse(response, action) {
  await response.body?.cancel();
  if (response.status === 429)
    throw new Error("Too many creation attempts. Wait a minute and try again.");
  throw new Error(`${action} failed (HTTP ${response.status}).`);
}

async function createSecret() {
  let text = await terminal.question("Enter your secret (one line): ");
  const choice = await ask(
    "Expiry: 1 = one hour, 2 = 24 hours, 3 = seven days [2]: ",
  );
  const expiresIn = { 1: 3600, 2: 86400, 3: 604800 }[choice || "2"];
  if (!expiresIn) throw new Error("Choose 1, 2, or 3 for expiry.");
  const { envelope, keyFragment } = await encryptText(text);
  text = "";
  const response = await post("/secrets", { envelope, expiresIn });
  if (response.status !== 201) await rejectResponse(response, "Creation");
  const { id, deleteToken, expiresAt } = await response.json();
  console.log("\nCreated. The backend received encrypted data only.");
  console.log(
    `\nSHARE CODE — give this to the recipient:\nxasha:${id}#${keyFragment}`,
  );
  console.log(
    `\nPRIVATE DELETE CODE — keep this yourself:\nxasha-delete:${id}#${deleteToken}`,
  );
  console.log(`\nExpires: ${expiresAt}`);
  console.log(
    "These are terminal codes. Paste them into this tool, not a browser.",
  );
}

async function revealSecret() {
  const { id, credential: key } = parseCode(
    await ask("Paste share code: "),
    "xasha",
  );
  if (
    (
      await ask("Reveal now? This consumes the secret. Type yes: ")
    ).toLowerCase() !== "yes"
  ) {
    console.log("Cancelled. No request was sent.");
    return;
  }
  // Only the ID goes to the backend. The key remains in this process.
  const response = await post(`/secrets/${id}/consume`);
  if (response.status === 404) {
    await response.body?.cancel();
    console.log("This secret is no longer available.");
    return;
  }
  if (response.status !== 200) await rejectResponse(response, "Retrieval");
  try {
    const { envelope } = await response.json();
    const text = await decryptText(envelope, key);
    console.log(`\nYOUR SECRET:\n${text}\n`);
    console.log("Consumed. The backend will not return it again.");
  } catch {
    throw new Error(
      "The secret was consumed, but could not be decrypted. Check that you copied the correct share code.",
    );
  }
}

async function deleteSecret() {
  const { id, credential: deleteToken } = parseCode(
    await ask("Paste private delete code: "),
    "xasha-delete",
  );
  if (
    (await ask("Delete without revealing? Type yes: ")).toLowerCase() !== "yes"
  ) {
    console.log("Cancelled. No request was sent.");
    return;
  }
  const response = await post(`/secrets/${id}/delete`, { deleteToken });
  if (response.status === 404) {
    await response.body?.cancel();
    console.log(
      "Could not delete: the secret is unavailable or the delete code is invalid.",
    );
    return;
  }
  if (response.status !== 204) await rejectResponse(response, "Deletion");
  console.log("Deleted. The share code can no longer reveal this secret.");
}

try {
  console.log(`Xasha interactive test — ${api.origin}`);
  console.log(
    "Use dummy text. Codes and revealed text appear in this terminal; the tool saves no files.",
  );
  while (true) {
    console.log(
      "\n1. Create a secret (sender)\n2. Reveal a secret (recipient)\n3. Delete a secret (sender)\n4. Exit",
    );
    const choice = await ask("Choose: ");
    if (choice === "4") break;
    try {
      if (choice === "1") await createSecret();
      else if (choice === "2") await revealSecret();
      else if (choice === "3") await deleteSecret();
      else console.log("Choose 1, 2, 3, or 4.");
    } catch (error) {
      console.log(error.message);
    }
  }
} catch (error) {
  if (error.code !== "ERR_USE_AFTER_CLOSE") {
    console.error("Terminal closed unexpectedly.");
    process.exitCode = 1;
  }
} finally {
  terminal.close();
}
