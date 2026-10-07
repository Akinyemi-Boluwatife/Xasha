export class ApiError extends Error {
  constructor(
    public status: 400 | 413 | 415 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const invalid = () =>
  new ApiError(400, "INVALID_REQUEST", "Invalid request.");
const tooLarge = () =>
  new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload exceeds the size limit.");

export function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodedLength(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  )
    throw invalid();
  // Bound the encoded length before allocating decoded bytes.
  if (value.length > 43712) throw tooLarge();
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  if (encode(bytes) !== value) throw invalid();
  return bytes.length;
}

export async function readBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 49152) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function jsonBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }
  const bytes = await readBody(request);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw invalid();
  }
}

export function randomToken(size: number): string {
  return encode(crypto.getRandomValues(new Uint8Array(size)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function database<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "The service is temporarily unavailable.",
    );
  }
}
