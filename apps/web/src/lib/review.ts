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
