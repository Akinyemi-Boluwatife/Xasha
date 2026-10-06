CREATE TABLE secrets (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 32),
  version INTEGER NOT NULL CHECK(version = 1),
  iv TEXT NOT NULL CHECK(length(iv) = 16),
  ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 23 AND 43712),
  delete_token_hash TEXT NOT NULL CHECK(length(delete_token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
) STRICT;

CREATE INDEX secrets_expiry ON secrets(expires_at);
