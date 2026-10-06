export type Bindings = {
  DB: D1Database;
  CREATE_LIMITER: RateLimit;
  MAX_SECRETS: string;
  MAX_STORAGE_BYTES: string;
  ALLOWED_ORIGINS: string;
  SERVICE_MODE: string;
};

export type AppEnv = { Bindings: Bindings };
export type Envelope = { version: number; iv: string; ciphertext: string };
