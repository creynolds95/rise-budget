import { localToday, shortDate } from './dates';

/** What `POST /sync/run` answers (apps/api/src/sync/run.ts `SyncResult`). */
export interface SyncRunResult {
  status: 'ok' | 'partial' | 'failed';
  rowsInserted: number;
  rowsUpdated: number;
  errors: { account?: string; message: string }[];
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * What a manual sync found, in one line. A sync that finds nothing new is the common case —
 * SimpleFIN only re-reads each bank about once a day — so it says so, and says when the
 * banks last reported, rather than looking like the button did nothing.
 */
export function syncOutcome(
  r: SyncRunResult,
  banksLastReportedMs: number | null,
  tz?: string,
): { text: string; tone: 'ok' | 'warn' } {
  const why = r.errors.map((e) => (e.account ? `${e.account}: ${e.message}` : e.message));
  if (r.status === 'failed') {
    return { text: `Sync failed${why[0] ? `: ${why[0]}` : '.'}`, tone: 'warn' };
  }
  const found =
    r.rowsInserted + r.rowsUpdated === 0
      ? `Nothing new from your banks${
          banksLastReportedMs === null
            ? '.'
            : ` — they last reported ${shortDate(localToday(tz, new Date(banksLastReportedMs)))}.`
        }`
      : [
          r.rowsInserted > 0 ? plural(r.rowsInserted, 'new transaction') : null,
          r.rowsUpdated > 0 ? `${r.rowsUpdated} updated` : null,
        ]
          .filter(Boolean)
          .join(', ') + '.';
  return why.length === 0
    ? { text: found, tone: 'ok' }
    : { text: `${found} ${why.join(' ')}`, tone: 'warn' };
}

/** The most recent bank report across synced accounts, or null if none has reported. */
export function banksLastReported(accounts: { lastSyncedAt: string | null }[]): number | null {
  const ms = accounts.flatMap((a) => (a.lastSyncedAt ? [Date.parse(a.lastSyncedAt)] : []));
  return ms.length === 0 ? null : Math.max(...ms);
}

/**
 * The brief note after a manual refresh: a failure, what arrived, or simply "up to date".
 * Connection problems are left to the persistent health notes, so they're said once.
 */
export function syncNote(r: SyncRunResult): { text: string; tone: 'ok' | 'warn' } {
  if (r.status === 'failed') return { text: 'Sync failed', tone: 'warn' };
  return r.rowsInserted > 0
    ? { text: plural(r.rowsInserted, 'new transaction'), tone: 'ok' }
    : { text: 'Accounts up to date', tone: 'ok' };
}
