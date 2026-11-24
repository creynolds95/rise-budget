export interface Env {
  DB: D1Database;
  /** R2 bucket for nightly backups (T46). Never served publicly. */
  BACKUPS: R2Bucket;
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
  /** Optional. Turns on the monthly report's written summary (SPEC §12.6); without it the
   * report still shows every figure and chart. Worker Secret; never returned or logged. */
  ANTHROPIC_API_KEY?: string;
  /** Optional. Adds the regional gas price to the monthly report (free key from eia.gov). */
  EIA_API_KEY?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string; sessionId: string; role: 'owner' | 'member' };
}
