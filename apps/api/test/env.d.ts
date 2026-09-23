import type * as main from '../src/index';

declare global {
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
