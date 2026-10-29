/**
 * Pure helpers for `setup.ts` (no I/O), kept apart so the Worker test pool can cover them.
 */

/** wrangler.toml's placeholders, swapped for real values in the git-ignored local copy. */
export const PLACEHOLDER_DB_ID = '00000000-0000-0000-0000-000000000000';
export const PLACEHOLDER_HOST = 'rise.example.workers.dev';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** The tracked wrangler.toml with this install's database id and host filled in. */
export function renderLocalConfig(template: string, databaseId: string, host: string): string {
  if (!UUID.test(databaseId)) throw new Error(`Not a D1 database id: ${databaseId}`);
  if (!HOST.test(host)) throw new Error(`Not a bare host name: ${host}`);
  if (!template.includes(PLACEHOLDER_DB_ID) || !template.includes(PLACEHOLDER_HOST)) {
    throw new Error('wrangler.toml no longer has the expected placeholders.');
  }
  return template.replaceAll(PLACEHOLDER_DB_ID, databaseId).replaceAll(PLACEHOLDER_HOST, host);
}

/** The id of the D1 database named `name` in `wrangler d1 list --json` output, if any. */
export function findDatabaseId(listJson: string, name: string): string | null {
  const rows = JSON.parse(listJson) as { name?: string; uuid?: string }[];
  const row = rows.find((r) => r.name === name);
  return row?.uuid && UUID.test(row.uuid) ? row.uuid : null;
}

/** The workers.dev host `wrangler deploy` printed for the Worker named `name`, if any. */
export function findDeployedHost(deployOutput: string, name: string): string | null {
  const m = deployOutput.match(new RegExp(`https://(${name}\\.[A-Za-z0-9.-]+\\.workers\\.dev)`));
  return m?.[1] ?? null;
}

/** A single number from `wrangler d1 execute --json` output (`SELECT COUNT(*) AS n …`). */
export function readCount(executeJson: string): number {
  const out = JSON.parse(executeJson) as { results?: { n?: number }[] }[];
  const n = out[0]?.results?.[0]?.n;
  if (typeof n !== 'number') throw new Error('Unexpected wrangler d1 execute output.');
  return n;
}

/** Names from `wrangler secret list` (JSON array of `{ name }`). */
export function secretNames(listJson: string): string[] {
  const rows = JSON.parse(listJson) as { name?: string }[];
  return rows.flatMap((r) => (typeof r.name === 'string' ? [r.name] : []));
}
