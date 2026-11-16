import {
  maskAccounts,
  redactText,
  sensitiveNames,
  type AccountIdentity,
  type MaskedAccount,
} from '@rise/shared/sync';
import {
  getDiagTxn,
  listBalanceObservations,
  listDiagAccounts,
  listSyncEvents,
  listSyncRuns,
  listTxnEvents,
  type BalanceObservationRow,
  type DiagAccountRow,
  type SyncEventRow,
  type UserId,
} from '../db';

/**
 * Redacted views over the sync log, for the owner and for a Claude session reading through
 * the connector. Accounts appear only as `acct-N` / `Bank A`; no name, nickname, institution,
 * account number, merchant or descriptor is ever in the output. Amounts are integer cents,
 * money out positive. Everything is scoped to one user.
 */

export const MAX_DAYS = 60;

const identity = (a: DiagAccountRow): AccountIdentity => ({
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

const flag = (v: number | null) => (v === null ? null : v === 1);

export interface Signal {
  account: string;
  at: string;
  kind: 'balance_moved_without_rows' | 'pending_not_sent';
  message: string;
}

/**
 * Plain-language pointers, not verdicts. The one that matters most: the bank's balance moved
 * between two syncs while no row arrived and no pending row explains it (the balance leads
 * the rows; see SPEC §6).
 */
export function findSignals(
  observations: readonly BalanceObservationRow[],
  events: readonly SyncEventRow[],
  masks: ReadonlyMap<string, MaskedAccount>,
): Signal[] {
  const out: Signal[] = [];
  const summaryOf = new Map<string, Record<string, number>>();
  for (const e of events) {
    if (e.kind !== 'summary') continue;
    summaryOf.set(
      `${e.run_id}|${e.account_id}`,
      (parse(e.detail_json) ?? {}) as Record<string, number>,
    );
  }
  const byAccount = new Map<string, BalanceObservationRow[]>();
  for (const o of [...observations].sort((a, b) => a.observed_at.localeCompare(b.observed_at))) {
    byAccount.set(o.account_id, [...(byAccount.get(o.account_id) ?? []), o]);
  }
  for (const [accountId, list] of byAccount) {
    const code = masks.get(accountId)?.code ?? 'acct-?';
    list.forEach((o, i) => {
      const prev = list[i - 1];
      const s: Record<string, number> = summaryOf.get(`${o.run_id}|${accountId}`) ?? {};
      if (prev && o.balance_cents !== prev.balance_cents) {
        const rows = (s['inserted'] ?? 0) + (s['pendingToPosted'] ?? 0) + (s['updated'] ?? 0);
        if (rows === 0 && o.sent_pending_cents === prev.sent_pending_cents)
          out.push({
            account: code,
            at: o.observed_at,
            kind: 'balance_moved_without_rows',
            message: `Balance moved ${o.balance_cents - prev.balance_cents} cents (as of ${o.balance_date}) with no new or changed rows and no change in pending rows sent.`,
          });
      }
      if ((s?.['pendingNotSent'] ?? 0) > 0)
        out.push({
          account: code,
          at: o.observed_at,
          kind: 'pending_not_sent',
          message: `${s?.['pendingNotSent']} stored pending row(s) were not sent by the bank this run.`,
        });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const clampDays = (days: number) => Math.max(1, Math.min(MAX_DAYS, Math.floor(days) || 7));

export async function buildDiagnostics(
  userId: UserId,
  db: D1Database,
  opts: { days?: number; limit?: number; now?: Date } = {},
) {
  const days = clampDays(opts.days ?? 7);
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 600));
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [accts, runs, events, observations] = await Promise.all([
    listDiagAccounts(userId, db),
    listSyncRuns(userId, db, 60),
    listSyncEvents(userId, db, since, limit),
    listBalanceObservations(userId, db, since, limit),
  ]);
  const ids = accts.map(identity);
  const masks = maskAccounts(ids);
  const names = sensitiveNames(ids);
  const code = (id: string) => masks.get(id)?.code ?? 'acct-?';

  const runIds = new Set<string>();
  for (const r of runs) if (r.started_at >= since) runIds.add(r.id);
  const eventsByRun = new Map<string, SyncEventRow[]>();
  for (const e of events) eventsByRun.set(e.run_id, [...(eventsByRun.get(e.run_id) ?? []), e]);

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    notes: [
      'Amounts are integer cents; money out is positive, money in is negative.',
      'Accounts, banks, merchants and account numbers are masked. Dates and amounts are real.',
      'Pending → posted is recorded as one event: the row keeps its id, so its history is one thread.',
    ],
    accounts: accts
      .filter((a) => masks.has(a.id))
      .map((a) => ({
        ...(masks.get(a.id) as MaskedAccount),
        balanceCents: a.balance_cents,
        lastReportedAt: a.last_synced_at,
        archived: a.archived_at !== null,
      }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    signals: findSignals(observations, events, masks),
    runs: runs
      .filter((r) => runIds.has(r.id))
      .map((r) => {
        const rows = eventsByRun.get(r.id) ?? [];
        const source = parse(r.source_json) as { fetch?: unknown; startDate?: string } | null;
        return {
          id: r.id,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          status: r.status,
          accountsTouched: r.accounts_touched,
          rowsInserted: r.rows_inserted,
          rowsUpdated: r.rows_updated,
          errors: ((parse(r.error_json) ?? []) as { message?: string }[]).map((e) =>
            redactText(String(e.message ?? ''), names),
          ),
          fetch: source?.fetch ?? null,
          windowStart: source?.startDate ?? null,
          accounts: rows
            .filter((e) => e.kind === 'summary')
            .map((e) => ({ account: code(e.account_id), ...(parse(e.detail_json) as object) })),
          events: rows
            .filter((e) => e.kind !== 'summary')
            .reverse()
            .map((e) => ({
              account: code(e.account_id),
              kind: e.kind,
              reason: e.reason,
              txn: e.txn_id,
              bankIdTail: e.source_tail,
              postedAt: e.posted_at,
              amountCents: e.amount_cents,
              wasPending: flag(e.was_pending),
              isPending: flag(e.is_pending),
              detail: parse(e.detail_json),
            })),
        };
      }),
    balances: observations
      .slice()
      .reverse()
      .map((o) => ({
        account: code(o.account_id),
        observedAt: o.observed_at,
        balanceDate: o.balance_date,
        reportedAt: o.reported_at,
        balanceCents: o.balance_cents,
        sent: { txns: o.sent_txns, pending: o.sent_pending, pendingCents: o.sent_pending_cents },
        storedPending: { count: o.stored_pending, cents: o.stored_pending_cents },
      })),
  };
}

/** One transaction's thread: where it stands now and every sync decision about it. */
export async function buildTxnHistory(userId: UserId, db: D1Database, txnId: string) {
  const [txn, accts, events] = await Promise.all([
    getDiagTxn(userId, db, txnId),
    listDiagAccounts(userId, db),
    listTxnEvents(userId, db, txnId),
  ]);
  if (!txn) return null;
  const masks = maskAccounts(accts.map(identity));
  const code = (id: string) => masks.get(id)?.code ?? 'acct-?';
  return {
    txn: {
      id: txn.id,
      account: code(txn.account_id),
      postedAt: txn.posted_at,
      amountCents: txn.amount_cents,
      isPending: txn.is_pending === 1,
      reviewState: txn.review_state,
      source: txn.source,
      createdAt: txn.created_at,
      updatedAt: txn.updated_at,
    },
    history: events.map((e) => ({
      at: e.created_at,
      kind: e.kind,
      reason: e.reason,
      postedAt: e.posted_at,
      amountCents: e.amount_cents,
      wasPending: flag(e.was_pending),
      isPending: flag(e.is_pending),
      detail: parse(e.detail_json),
    })),
    retentionDays: 60,
  };
}
