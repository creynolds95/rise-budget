import { bandOf, type Band } from '@rise/shared/categorize';
import type { Transaction } from '@rise/shared/schemas';

export type QueueItem = Transaction & { topCategoryIds: string[] };

export type QueueRow =
  { kind: 'txn'; t: QueueItem; band: Band } | { kind: 'transfer'; out: QueueItem; in: QueueItem };

export interface QueueDay {
  date: string;
  /** Money out that day, transfers excluded (SPEC §3.3). Income nets against it. */
  totalCents: number;
  rows: QueueRow[];
}

/**
 * SPEC §8: grouped by date, newest first, per-day totals, and a linked transfer as one row.
 * A pair shows under the later leg's date; a leg whose partner isn't waiting shows alone.
 */
export function groupQueue(items: readonly QueueItem[]): QueueDay[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const days = new Map<string, QueueDay>();
  const sorted = [...items].sort((a, b) =>
    a.postedAt === b.postedAt ? (a.id < b.id ? 1 : -1) : a.postedAt < b.postedAt ? 1 : -1,
  );
  for (const t of sorted) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const other = t.transferPairId ? byId.get(t.transferPairId) : undefined;
    let row: QueueRow;
    if (other && !seen.has(other.id)) {
      seen.add(other.id);
      row =
        t.amountCents > 0
          ? { kind: 'transfer', out: t, in: other }
          : { kind: 'transfer', out: other, in: t };
    } else {
      row = { kind: 'txn', t, band: bandOf(t.suggestedCategoryId ? t.suggestionConfidence : 0) };
    }
    const day = days.get(t.postedAt) ?? { date: t.postedAt, totalCents: 0, rows: [] };
    if (row.kind === 'txn' && !t.isTransfer) day.totalCents += t.amountCents;
    day.rows.push(row);
    days.set(t.postedAt, day);
  }
  return [...days.values()];
}

/** How many rows "Accept all confident" would file. */
export const confidentCount = (items: readonly QueueItem[]) =>
  items.filter(
    (t) => t.suggestedCategoryId && !t.isTransfer && bandOf(t.suggestionConfidence) === 'confident',
  ).length;

export interface ChipContext {
  /** Category id → its group's kind. */
  kinds: ReadonlyMap<string, 'income' | 'expense'>;
  /** Categories in display order, the last-resort fill. */
  ordered: readonly string[];
  /** Most-used lately, from the queue endpoint. */
  frequent: readonly string[];
  /**
   * Never used as filler: transfer-like (unbudgeted) categories, which the Transfer offer
   * covers, and the catch-all, which is where a row already lands with no choice at all.
   * A merchant's own history still offers them.
   */
  quiet?: ReadonlySet<string>;
}

/**
 * One-tap choices for a row that isn't pre-filled (SPEC §4.5): the merchant's own top
 * categories first, then what the user files most, then anything, so even the first week
 * is one tap. Money in leads with income categories; a refund still finds its merchant's.
 * These are choices, never a pre-fill.
 */
export function chipsFor(
  t: Pick<QueueItem, 'amountCents' | 'topCategoryIds' | 'suggestedCategoryId'>,
  ctx: ChipContext,
  max = 4,
): string[] {
  const order: ('income' | 'expense')[] = t.amountCents < 0 ? ['income', 'expense'] : ['expense'];
  const pool = [
    ...t.topCategoryIds,
    ...order.flatMap((k) =>
      [...ctx.frequent, ...ctx.ordered].filter(
        (id) => ctx.kinds.get(id) === k && !ctx.quiet?.has(id),
      ),
    ),
  ];
  const out: string[] = [];
  for (const id of pool) {
    if (out.length === max) break;
    if (!ctx.kinds.has(id) || id === t.suggestedCategoryId || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

const MOVE = /PAYMENT|\bPMT\b|AUTOPAY|AUTO PAY|THANK YOU|TRANSFER|\bXFER\b/;
const CARD = /CARD|\bCRD\b|CREDIT|AMEX|CITI|CHASE|DISCOVER|CAPITAL ONE|GSBANK|SYNCHRONY/;

/**
 * Whether to offer "this is a transfer" on a lone row — money moving between the user's own
 * accounts whose other side hasn't arrived (an Apple Card payment reports a month late).
 * Offered, never applied: the user taps it (SPEC §3.3, §3.4).
 */
export function transferOffer(
  t: Pick<QueueItem, 'descriptorRaw' | 'isTransfer' | 'amountCents'>,
  accountKind: string | undefined,
): 'card_payment' | 'transfer' | null {
  if (t.isTransfer || t.amountCents === 0) return null;
  const d = t.descriptorRaw.toUpperCase();
  if (!MOVE.test(d)) return null;
  if (accountKind === 'credit' || CARD.test(d)) return 'card_payment';
  return 'transfer';
}
