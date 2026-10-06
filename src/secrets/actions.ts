import { ApiError, database, hashToken, randomToken } from "../protocol";
import type { Bindings, Envelope } from "../types";

export async function createSecret(
  env: Bindings,
  envelope: Envelope,
  expiresIn: number,
) {
  const id = randomToken(24);
  const deleteToken = randomToken(32);
  const hash = await hashToken(deleteToken);
  const now = Date.now();
  const expiresAt = now + expiresIn * 1000;
  const maxSecrets = Number(env.MAX_SECRETS);
  const maxBytes = Number(env.MAX_STORAGE_BYTES);
  if (
    ![maxSecrets, maxBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "The service is temporarily unavailable.",
    );
  }
  // The capacity predicate and insertion are one write. Triggers update the
  // shared counter in that same transaction, including all delete paths.
  const stored = await database(() =>
    env.DB.prepare(
      `INSERT INTO secrets (id, version, iv, ciphertext, delete_token_hash, created_at, expires_at)
     SELECT ?1, 1, ?2, ?3, ?4, ?5, ?6 FROM storage_usage
     WHERE singleton = 1 AND secret_count < ?7 AND payload_bytes + ?8 <= ?9`,
    )
      .bind(
        id,
        envelope.iv,
        envelope.ciphertext,
        hash,
        now,
        expiresAt,
        maxSecrets,
        envelope.ciphertext.length + 128,
        maxBytes,
      )
      .run(),
  );
  if (!stored.meta.changes)
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "The service is temporarily unavailable.",
    );

  return { id, deleteToken, expiresAt: new Date(expiresAt).toISOString() };
}

export async function consumeSecret(db: D1Database, id: string): Promise<Envelope | undefined> {
  // One statement removes the row and returns its envelope. Never retry:
  // consumption cannot safely be replayed after a lost response.
  const result = await database(() => db.prepare(
    "DELETE FROM secrets WHERE id = ?1 AND expires_at > ?2 RETURNING version, iv, ciphertext",
  ).bind(id, Date.now()).all<Envelope>());
  return result.results[0];
}

export async function deleteSecret(db: D1Database, id: string, deleteToken: string): Promise<boolean> {
  const hash = await hashToken(deleteToken);
  const result = await database(() => db.prepare(
    "DELETE FROM secrets WHERE id = ?1 AND delete_token_hash = ?2 AND expires_at > ?3 RETURNING id",
  ).bind(id, hash, Date.now()).all());
  return result.results.length > 0;
}
