export interface Env {
  DB: D1Database;
  /** HS256 key for access JWTs and signed challenges. Worker Secret. */
  JWT_SECRET: string;
  /** base64 32-byte AES-GCM key encrypting TOTP secrets at rest. Worker Secret. */
  TOTP_KEY: string;
  RP_ID: string;
  RP_ORIGIN: string;
  RP_NAME: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string; sessionId: string };
}
