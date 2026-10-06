import { dayNumber } from '../networth';

/**
 * Refund association. Pure. A refund is an inflow tied to the purchase it reverses, so it
 * offsets that purchase's category(ies) instead of landing wherever its own merchant guess
 * puts it. Outflows are positive cents, inflows negative (SPEC §1.1).
 */

export interface RefundTxn {
  id: string;
  accountId: string;
  postedAt: string;
  amountCents: number;
  isTransfer: boolean;
}

/** Suggestions: refunds usually land within a month or two of the charge. */
export const REFUND_MAX_DAYS = 90;

/**
 * Can `refund` be linked to `original`? `alreadyRefundedCents` is what earlier refunds of the
 * same purchase already returned (positive). A refund can't exceed what's left.
 */
export function refundFits(
  refund: RefundTxn,
  original: RefundTxn,
  alreadyRefundedCents: number,
): boolean {
  if (refund.id === original.id || refund.isTransfer || original.isTransfer) return false;
  if (refund.amountCents >= 0 || original.amountCents <= 0) return false;
  if (dayNumber(refund.postedAt) < dayNumber(original.postedAt)) return false;
  return -refund.amountCents <= original.amountCents - alreadyRefundedCents;
}

/** Likeliest purchase first: exact amount, then the closest date, then id. */
export function suggestRefundOriginals(
  refund: RefundTxn,
  pool: readonly RefundTxn[],
  refundedBy: (id: string) => number,
): RefundTxn[] {
  const gap = (o: RefundTxn) => dayNumber(refund.postedAt) - dayNumber(o.postedAt);
  const exact = (o: RefundTxn) => (o.amountCents === -refund.amountCents ? 0 : 1);
  return pool
    .filter((o) => refundFits(refund, o, refundedBy(o.id)) && gap(o) <= REFUND_MAX_DAYS)
    .sort((p, q) => exact(p) - exact(q) || gap(p) - gap(q) || p.id.localeCompare(q.id));
}

/**
 * Spreads a refund over the purchase's splits in proportion to each split, so refunding a
 * $100 purchase split 60/40 returns $60/$40. Largest remainder keeps the sum exact; ties go
 * to the earlier split. Returns negative cents per split, summing to `refundCents`.
 */
export function allocateRefund(
  refundCents: number,
  originalSplits: readonly { categoryId: string; amountCents: number }[],
): { categoryId: string; amountCents: number }[] {
  const total = originalSplits.reduce((s, x) => s + x.amountCents, 0);
  const share = -refundCents; // positive cents to hand back
  const exact = originalSplits.map((s) => (s.amountCents * share) / total);
  const floors = exact.map(Math.floor);
  let left = share - floors.reduce((s, x) => s + x, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] as number) + 1;
    left -= 1;
  }
  return originalSplits.map((s, i) => ({
    categoryId: s.categoryId,
    amountCents: -(floors[i] as number),
  }));
}
