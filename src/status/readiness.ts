import type { Bindings } from "../types";

export async function isReady(env: Bindings): Promise<boolean> {
  if (env.SERVICE_MODE !== "active") return false;
  const limits = [Number(env.MAX_SECRETS), Number(env.MAX_STORAGE_BYTES)];
  if (!limits.every((value) => Number.isSafeInteger(value) && value > 0))
    return false;
  try {
    // Read aggregate metadata only. Check the secret table's schema without reading secret rows.
    const state = await env.DB.prepare(
      `SELECT secret_count, payload_bytes FROM storage_usage WHERE singleton = 1
       AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'secrets')`,
    ).first<{ secret_count: number; payload_bytes: number }>();
    if (
      !state ||
      ![state.secret_count, state.payload_bytes].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
