// Placeholder until T2 (Hono + D1 bootstrap). Proves the workspace link to @rise/shared.
import { pool } from '@rise/shared/budget';
import { ApiError } from '@rise/shared/schemas';

export const health = () => ({ ok: true as const });
export { pool, ApiError };
