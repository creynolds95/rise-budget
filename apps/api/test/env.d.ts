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
      TEST_MIGRATIONS: { name: string; queries: string[] }[];
    }
  }
}
