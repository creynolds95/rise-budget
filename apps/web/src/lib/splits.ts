/**
 * The split editor's arithmetic (SPEC §3.5): every row but the last is typed; the last is
 * whatever remains, so the set always sums exactly to the transaction.
 */
export interface DraftSplit {
  categoryId: string;
  amountCents: number;
}

export function withRemainder(
  totalCents: number,
  typed: readonly DraftSplit[],
  lastCategoryId: string,
): DraftSplit[] {
  const used = typed.reduce((n, s) => n + s.amountCents, 0);
  return [...typed, { categoryId: lastCategoryId, amountCents: totalCents - used }];
}

export type SplitProblem = 'missing_category' | 'zero_row' | 'remainder_flips_sign' | null;

/** Why a draft can't be saved yet, or null. A remainder past zero means the typed rows overshoot. */
export function splitProblem(totalCents: number, rows: readonly DraftSplit[]): SplitProblem {
  if (rows.some((r) => !r.categoryId)) return 'missing_category';
  if (rows.some((r) => r.amountCents === 0)) return 'zero_row';
  const last = rows.at(-1);
  if (last && totalCents !== 0 && Math.sign(last.amountCents) !== Math.sign(totalCents))
    return 'remainder_flips_sign';
  return null;
}

/**
 * What a split transaction puts in one category: the sum of that category's splits, or null
 * when the transaction isn't split across categories (the full amount is already the answer).
 */
export function categoryPortion(
  splits: readonly { categoryId: string; amountCents: number }[],
  categoryId: string,
): number | null {
  if (new Set(splits.map((s) => s.categoryId)).size < 2) return null;
  return splits.filter((s) => s.categoryId === categoryId).reduce((n, s) => n + s.amountCents, 0);
}

/** The distinct category emojis of a split, in split order; categories without one are skipped. */
export function splitEmojis(
  splits: readonly { categoryId: string }[],
  emojiOf: (categoryId: string) => string | null | undefined,
): string[] {
  const out: string[] = [];
  for (const s of splits) {
    const e = emojiOf(s.categoryId);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}
