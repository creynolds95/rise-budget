/**
 * The query layer — THE ONLY place SQL lives (ARCHITECTURE §2).
 *
 * Rule: every exported query function takes `userId` as its first parameter and every SQL
 * statement filters on `user_id`. `test/db-scoping.test.ts` scans this directory and fails
 * the build if a statement omits it. The one table without a `user_id` column is `user`
 * itself; statements against it are keyed on `id` and carry the marker `/* scoped:user.id *\/`.
 */

export type UserId = string;

export const nowIso = (): string => new Date().toISOString();

export const newId = (): string => crypto.randomUUID();

export const bool = (v: boolean): 0 | 1 => (v ? 1 : 0);
