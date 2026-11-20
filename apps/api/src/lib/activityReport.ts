import { clientRoute } from '@rise/shared/activity';
import { maskAccounts, redactText, sensitiveNames, type AccountIdentity } from '@rise/shared/sync';
import {
  activityCounts,
  dayKey,
  hourKey,
  listActivity,
  listDiagAccounts,
  listLogDays,
  listPerf,
  listSlowQueries,
  listSyncRuns,
  syncEventDaily,
  type PerfRow,
  type UserId,
} from '../db';
import { ACTIVITY_RETENTION } from '../db/backup';
import { buildDiagnostics } from './diagnostics';

/**
 * The on-demand review: one call that answers "how has Rise been behaving". Read-only and
 * redacted exactly like /diagnostics (accounts as acct-N, no merchants, notes or names;
 * amounts and dates real). `summary` is small enough to read in one go; `detail` adds every
 * edit with its before/after and the sync decisions behind each run.
 */

export const REVIEW_MAX_DAYS = 180;
const DETAIL_MAX_DAYS = 60;

const identity = (a: Awaited<ReturnType<typeof listDiagAccounts>>[number]): AccountIdentity => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  nickname: a.nickname,
  institutionName: a.institution_name,
  sourceAccountId: a.source_account_id,
  createdAt: a.created_at,
});

const parse = (json: string | null): unknown => {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

interface PerfAgg {
  kind: string;
  route: string;
  requests: number;
  errors: number;
  slow: number;
  avgMs: number;
  maxMs: number;
  rowsRead: number;
}

export function aggregatePerf(rows: readonly PerfRow[]): PerfAgg[] {
  const by = new Map<string, PerfAgg & { msTotal: number }>();
  for (const r of rows) {
    const k = `${r.kind} ${r.route}`;
    const a = by.get(k) ?? {
      kind: r.kind,
      route: r.route,
      requests: 0,
      errors: 0,
      slow: 0,
      avgMs: 0,
      maxMs: 0,
      rowsRead: 0,
      msTotal: 0,
    };
    a.requests += r.requests;
    a.errors += r.errors;
    a.slow += r.slow;
    a.msTotal += r.ms_total;
    a.maxMs = Math.max(a.maxMs, r.ms_max);
    a.rowsRead += r.rows_read;
    by.set(k, a);
  }
  return [...by.values()]
    .map(({ msTotal, ...a }) => ({ ...a, avgMs: Math.round(msTotal / Math.max(1, a.requests)) }))
    .sort((a, b) => b.avgMs * b.requests - a.avgMs * a.requests);
}

export async function buildActivityReport(
  userId: UserId,
  db: D1Database,
  opts: { days?: number; mode?: 'summary' | 'detail'; now?: Date } = {},
) {
  const mode = opts.mode === 'detail' ? 'detail' : 'summary';
  const maxDays = mode === 'detail' ? DETAIL_MAX_DAYS : REVIEW_MAX_DAYS;
  const days = Math.max(1, Math.min(maxDays, Math.floor(opts.days ?? 7) || 7));
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const perfSince = new Date(
    Math.max(
      now.getTime() - days * 86_400_000,
      now.getTime() - ACTIVITY_RETENTION.perfHourDays * 86_400_000,
    ),
  );

  const [accts, runs, daily, counts, perfRows, slow, rolled, edits, diag] = await Promise.all([
    listDiagAccounts(userId, db),
    listSyncRuns(userId, db, 200),
    syncEventDaily(userId, db, since),
    activityCounts(userId, db, since),
    listPerf(db, hourKey(perfSince)),
    listSlowQueries(db, dayKey(new Date(since)), 10),
    listLogDays(userId, db, dayKey(new Date(since))),
    mode === 'detail' ? listActivity(userId, db, since, 400) : Promise.resolve([]),
    buildDiagnostics(userId, db, { days: Math.min(days, DETAIL_MAX_DAYS), limit: 600, now }),
  ]);
  const ids = accts.map(identity);
  const masks = maskAccounts(ids);
  const names = sensitiveNames(ids);
  const code = (id: string) => masks.get(id)?.code ?? 'acct-?';

  const inWindow = runs.filter((r) => r.started_at >= since);
  const fetchMs: number[] = [];
  const totalMs: number[] = [];
  const errorGroups = new Map<string, number>();
  const perAccount = new Map<
    string,
    { runs: number; ms: number; fetched: number; inserted: number; updated: number }
  >();
  for (const r of inWindow) {
    const src = parse(r.source_json) as {
      fetch?: { ms?: number };
      timing?: {
        totalMs?: number;
        accounts?: {
          accountId: string;
          ms: number;
          fetched: number;
          inserted: number;
          updated: number;
        }[];
      };
    } | null;
    if (typeof src?.fetch?.ms === 'number') fetchMs.push(src.fetch.ms);
    if (typeof src?.timing?.totalMs === 'number') totalMs.push(src.timing.totalMs);
    for (const t of src?.timing?.accounts ?? []) {
      const a = perAccount.get(t.accountId) ?? {
        runs: 0,
        ms: 0,
        fetched: 0,
        inserted: 0,
        updated: 0,
      };
      a.runs++;
      a.ms += t.ms;
      a.fetched += t.fetched;
      a.inserted += t.inserted;
      a.updated += t.updated;
      perAccount.set(t.accountId, a);
    }
    for (const e of (parse(r.error_json) ?? []) as { message?: string }[]) {
      const msg = redactText(String(e.message ?? ''), names);
      errorGroups.set(msg, (errorGroups.get(msg) ?? 0) + 1);
    }
  }
  const stat = (xs: number[]) =>
    xs.length === 0
      ? null
      : {
          n: xs.length,
          avgMs: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length),
          maxMs: Math.max(...xs),
        };

  const perf = aggregatePerf(perfRows);
  const byStatus: Record<string, number> = {};
  for (const r of inWindow) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    mode,
    notes: [
      'Times are UTC. Amounts are integer cents, money out positive.',
      'Accounts are acct-N / Bank A; notes, names and merchants are never logged (edits to them appear as "changed").',
      `Detail is kept: sync decisions 60 days, edits ${ACTIVITY_RETENTION.activityDays} days, hourly performance ${ACTIVITY_RETENTION.perfHourDays} days. Older days survive as daily totals under rolledUp.`,
      'The sync makes one request per run and does not retry, so retries are always 0.',
    ],
    sync: {
      runs: inWindow.length,
      byStatus,
      startedAt: inWindow.slice(0, 40).map((r) => ({
        at: r.started_at,
        status: r.status,
        inserted: r.rows_inserted,
        updated: r.rows_updated,
      })),
      fetchLatency: stat(fetchMs),
      runDuration: stat(totalMs),
      errors: [...errorGroups].map(([message, count]) => ({ message, count })),
      accounts: accts
        .filter((a) => masks.has(a.id))
        .map((a) => ({
          account: code(a.id),
          lastReportedAt: a.last_synced_at,
          ...(perAccount.get(a.id) ?? { runs: 0, ms: 0, fetched: 0, inserted: 0, updated: 0 }),
        }))
        .sort((x, y) => x.account.localeCompare(y.account, undefined, { numeric: true })),
      rowsByDay: daily,
    },
    edits: {
      total: counts.reduce((s, c) => s + c.n, 0),
      failed: counts.reduce((s, c) => s + (c.failed ?? 0), 0),
      byAction: counts
        .map((c) => ({
          entity: c.entity,
          action: c.action,
          n: c.n,
          failed: c.failed ?? 0,
          avgMs: Math.round(c.ms_total / Math.max(1, c.n)),
        }))
        .sort((a, b) => b.n - a.n),
      ...(mode === 'detail'
        ? {
            events: edits.map((e) => ({
              at: e.at,
              entity: e.entity,
              id: e.entity_id,
              action: e.action,
              status: e.status,
              ms: e.ms,
              changes: parse(e.changes_json),
            })),
          }
        : {}),
    },
    performance: {
      api: perf.filter((p) => p.kind === 'api').slice(0, 15),
      cron: perf.filter((p) => p.kind === 'cron'),
      client: perf
        .filter((p) => p.kind === 'client')
        .slice(0, 15)
        .map((p) => ({ ...p, route: clientRoute(p.route) })),
      slowQueries: slow.map((s) => ({
        day: s.day,
        sql: s.sql,
        times: s.n,
        maxMs: s.ms_max,
        maxRowsRead: s.rows_max,
      })),
      errorsTotal: perf.reduce((s, p) => s + p.errors, 0),
      requestsTotal: perf.reduce((s, p) => s + p.requests, 0),
    },
    rolledUp: rolled,
    signals: diag.signals,
    ...(mode === 'detail' ? { syncDetail: { runs: diag.runs, balances: diag.balances } } : {}),
  };
}
