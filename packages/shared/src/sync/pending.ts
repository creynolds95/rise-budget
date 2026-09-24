import type { IncomingTxn } from '../import/adapters/simplefin';
import { dayNumber } from '../networth';
import { similarity } from './trigram';

/**
 * Per-account sync planning (SPEC §3.2, §6.1). Pure. Given what's already stored for the
 * account and what SimpleFIN returned, decide what to insert, update in place, or drop.
 * Re-running over the same data plans nothing (edge 12).
 */

export interface StoredTxn {
  id: string;
  sourceId: string | null;
  postedAt: string;
  amountCents: number;
  descriptor: string;
  merchant: string;
  isPending: boolean;
  dropped: boolean;
}

export interface IncomingWithMerchant extends IncomingTxn {
  merchant: string;
}

export type SyncOp =
  | { kind: 'insert'; incoming: IncomingWithMerchant }
  /** In place: the row keeps its category, splits, notes and review state. */
  | { kind: 'update'; id: string; incoming: IncomingWithMerchant; matchedPending: boolean }
  | { kind: 'drop'; id: string };

export const PENDING_MATCH_DAYS = 7;
export const PENDING_DROP_DAYS = 14;
export const MERCHANT_SIMILARITY = 0.8;

/** `|P − Q| ≤ max($1, 2% of P)`, in integers. */
export function withinTolerance(pendingCents: number, postedCents: number): boolean {
  return 100 * Math.abs(pendingCents - postedCents) <= Math.max(10_000, 2 * Math.abs(pendingCents));
}

export function sameMerchant(a: string, b: string): boolean {
  return a === b || similarity(a, b) >= MERCHANT_SIMILARITY;
}

/** SPEC §3.2: could pending P have become posted Q? */
export function pendingMatches(p: StoredTxn, q: IncomingWithMerchant): boolean {
  const gap = dayNumber(q.postedAt) - dayNumber(p.postedAt);
  return (
    gap >= 0 &&
    gap <= PENDING_MATCH_DAYS &&
    withinTolerance(p.amountCents, q.amountCents) &&
    sameMerchant(p.merchant, q.merchant)
  );
}

const changed = (s: StoredTxn, i: IncomingWithMerchant) =>
  s.postedAt !== i.postedAt ||
  s.amountCents !== i.amountCents ||
  s.descriptor !== i.descriptor ||
  s.isPending !== i.pending ||
  s.dropped;

export function planAccountSync(
  stored: readonly StoredTxn[],
  incoming: readonly IncomingWithMerchant[],
  today: string,
): SyncOp[] {
  const ops: SyncOp[] = [];
  const bySource = new Map(stored.filter((s) => s.sourceId).map((s) => [s.sourceId, s]));
  const claimed = new Set<string>();
  const unmatched: IncomingWithMerchant[] = [];

  // 1. Same source id: refresh in place if anything moved.
  for (const i of incoming) {
    const s = bySource.get(i.sourceId);
    if (!s) {
      unmatched.push(i);
      continue;
    }
    claimed.add(s.id);
    if (changed(s, i)) ops.push({ kind: 'update', id: s.id, incoming: i, matchedPending: false });
  }

  // 2. A new posted row may be a stored pending one under a new id.
  const openPending = stored.filter((s) => s.isPending && !s.dropped && !claimed.has(s.id));
  for (const q of unmatched) {
    const best = q.pending
      ? undefined
      : openPending
          .filter((p) => !claimed.has(p.id) && pendingMatches(p, q))
          .sort(
            (a, b) =>
              Math.abs(a.amountCents - q.amountCents) - Math.abs(b.amountCents - q.amountCents) ||
              dayNumber(b.postedAt) - dayNumber(a.postedAt) ||
              a.id.localeCompare(b.id),
          )[0];
    if (best) {
      claimed.add(best.id);
      ops.push({ kind: 'update', id: best.id, incoming: q, matchedPending: true });
    } else {
      ops.push({ kind: 'insert', incoming: q });
    }
  }

  // 3. A pending row that vanished and found no match within 14 days is dropped.
  for (const p of openPending) {
    if (!claimed.has(p.id) && dayNumber(today) - dayNumber(p.postedAt) >= PENDING_DROP_DAYS) {
      ops.push({ kind: 'drop', id: p.id });
    }
  }
  return ops;
}
