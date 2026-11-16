import { dayNumber } from '../networth';
import type { IncomingWithMerchant, StoredTxn, SyncOp } from './pending';

/**
 * What the sync log records (diagnostics). Pure: turns the planner's ops into plain events
 * with a reason, so "why did this row appear / change / vanish" can be answered from data.
 * It never holds names or descriptors, only amounts, dates, flags and a short id tail.
 */

export type SyncEventKind =
  'insert' | 'pending_to_posted' | 'update' | 'drop' | 'skip_deleted' | 'summary';

export interface SyncEventDraft {
  kind: SyncEventKind;
  reason: string;
  txnId: string | null;
  sourceTail: string | null;
  postedAt: string | null;
  amountCents: number | null;
  wasPending: boolean | null;
  isPending: boolean | null;
  detail: Record<string, unknown> | null;
}

export interface AccountSummary {
  sent: number;
  sentPending: number;
  sentPendingCents: number;
  storedPending: number;
  storedPendingCents: number;
  /** Stored open pending rows the bank did not send this time (and that weren't matched). */
  pendingNotSent: number;
  inserted: number;
  pendingToPosted: number;
  updated: number;
  dropped: number;
  /** Sent, already stored, nothing changed. */
  unchanged: number;
  skippedDeleted: number;
}

export const sourceTail = (id: string | null | undefined): string | null =>
  id ? id.slice(-6) : null;

/**
 * One event per planner op, plus the account summary. `newIds` are the ids given to the
 * insert ops, in the order those ops appear.
 */
export function explainSyncOps(
  stored: readonly StoredTxn[],
  incoming: readonly IncomingWithMerchant[],
  ops: readonly SyncOp[],
  newIds: readonly string[],
  skippedDeleted: readonly string[],
  today: string,
): { events: SyncEventDraft[]; summary: AccountSummary } {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const events: SyncEventDraft[] = [];
  let insertIx = 0;
  let pendingToPosted = 0;
  let updated = 0;
  let inserted = 0;
  let dropped = 0;
  const touched = new Set<string>();

  for (const o of ops) {
    if (o.kind === 'insert') {
      inserted++;
      events.push({
        kind: 'insert',
        reason: o.incoming.pending ? 'new pending row' : 'new posted row, no pending match',
        txnId: newIds[insertIx++] ?? null,
        sourceTail: sourceTail(o.incoming.sourceId),
        postedAt: o.incoming.postedAt,
        amountCents: o.incoming.amountCents,
        wasPending: null,
        isPending: o.incoming.pending,
        detail: null,
      });
      continue;
    }
    if (o.kind === 'drop') {
      dropped++;
      touched.add(o.id);
      const s = byId.get(o.id);
      events.push({
        kind: 'drop',
        reason: 'pending row no longer sent and unmatched for 14 days',
        txnId: o.id,
        sourceTail: sourceTail(s?.sourceId),
        postedAt: s?.postedAt ?? null,
        amountCents: s?.amountCents ?? null,
        wasPending: true,
        isPending: null,
        detail: s ? { ageDays: dayNumber(today) - dayNumber(s.postedAt) } : null,
      });
      continue;
    }
    touched.add(o.id);
    const s = byId.get(o.id);
    const i = o.incoming;
    const becamePosted = s?.isPending === true && !i.pending;
    const changes: Record<string, unknown> = {};
    if (s) {
      if (s.postedAt !== i.postedAt) changes['postedAt'] = [s.postedAt, i.postedAt];
      if (s.amountCents !== i.amountCents) changes['amountCents'] = [s.amountCents, i.amountCents];
      if (s.descriptor !== i.descriptor) changes['descriptor'] = true;
      if (s.isPending !== i.pending) changes['pending'] = [s.isPending, i.pending];
      if (s.dropped) changes['restoredFromDropped'] = true;
      if (s.sourceId !== i.sourceId) changes['newSourceId'] = true;
    }
    let kind: SyncEventKind = 'update';
    let reason = 'same bank id, fields changed';
    if (o.matchedPending) {
      kind = 'pending_to_posted';
      reason =
        'posted row matched a stored pending row (new bank id; amount, merchant, date within tolerance)';
      pendingToPosted++;
    } else if (becamePosted) {
      kind = 'pending_to_posted';
      reason = 'same bank id, pending flag cleared';
      pendingToPosted++;
    } else {
      updated++;
    }
    events.push({
      kind,
      reason,
      txnId: o.id,
      sourceTail: sourceTail(i.sourceId),
      postedAt: i.postedAt,
      amountCents: i.amountCents,
      wasPending: s?.isPending ?? null,
      isPending: i.pending,
      detail: Object.keys(changes).length > 0 ? changes : null,
    });
  }

  for (const sid of skippedDeleted) {
    events.push({
      kind: 'skip_deleted',
      reason: 'the owner deleted this row; the bank still sends it',
      txnId: null,
      sourceTail: sourceTail(sid),
      postedAt: null,
      amountCents: null,
      wasPending: null,
      isPending: null,
      detail: null,
    });
  }

  const sentPending = incoming.filter((i) => i.pending);
  const openPending = stored.filter((s) => s.isPending && !s.dropped);
  const summary: AccountSummary = {
    sent: incoming.length,
    sentPending: sentPending.length,
    sentPendingCents: sentPending.reduce((n, i) => n + i.amountCents, 0),
    storedPending: openPending.length,
    storedPendingCents: openPending.reduce((n, s) => n + s.amountCents, 0),
    pendingNotSent: openPending.filter(
      (s) => !touched.has(s.id) && !incoming.some((i) => i.sourceId === s.sourceId),
    ).length,
    inserted,
    pendingToPosted,
    updated,
    dropped,
    unchanged: Math.max(0, incoming.length - inserted - pendingToPosted - updated),
    skippedDeleted: skippedDeleted.length,
  };
  // A quiet account writes no summary: its balance observation already holds the counts.
  if (events.length > 0 || summary.pendingNotSent > 0) {
    events.push({
      kind: 'summary',
      reason: 'account totals for this run',
      txnId: null,
      sourceTail: null,
      postedAt: null,
      amountCents: null,
      wasPending: null,
      isPending: null,
      detail: { ...summary },
    });
  }
  return { events, summary };
}
