export interface Env {
  DB: D1Database;
  /** HS256 key for access JWTs and signed challenges. Worker Secret. */
  JWT_SECRET: string;
  /** base64 32-byte AES-GCM key encrypting TOTP secrets at rest. Worker Secret. */
  TOTP_KEY: string;
  RP_ID: string;
  RP_ORIGIN: string;
  RP_NAME: string;
  /** SimpleFIN access URL from `pnpm simplefin:claim`. Worker Secret; never returned or logged. */
  SIMPLEFIN_ACCESS_URL?: string;
  /** "1" in local dev only: sync from the built-in mock bridge instead. */
  SIMPLEFIN_MOCK?: string;
  /** Whose data the scheduled sync writes (single-user app). */
  SIMPLEFIN_OWNER_EMAIL?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string; sessionId: string };
}
