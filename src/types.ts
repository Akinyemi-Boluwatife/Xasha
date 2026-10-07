export type Bindings = {
  DB: D1Database;
  CREATE_LIMITER: RateLimit;
  ACCESS_LIMITER: RateLimit;
  READINESS_LIMITER: RateLimit;
  MAX_SECRETS: string;
  MAX_STORAGE_BYTES: string;
  ALLOWED_ORIGINS: string;
  SERVICE_MODE: string;
};

export type AppEnv = { Bindings: Bindings };
export type Envelope = import("zod").infer<typeof import("./secrets/schemas").envelopeSchema>;
