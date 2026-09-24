import type * as main from '../src/index';

declare global {
  /** Vite's glob import, used to scan src/db in the scoping test. */
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }

  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof main;
    }
    interface Env {
      DB: D1Database;
      BACKUPS: R2Bucket;
      RESTORE: D1Database;
      JWT_SECRET: string;
      TOTP_KEY: string;
      RP_ID: string;
      RP_ORIGIN: string;
      RP_NAME: string;
      TEST_MIGRATIONS: { name: string; queries: string[] }[];
    }
  }
}
