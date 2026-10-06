import { assertCents, sumCents, type Cents } from './money';

export interface AllocationChange {
  targetCategoryId: string;
  oldPlannedCents: Cents;
  newPlannedCents: Cents;
}

// ── applying it ───────────────────────────────────────────────────────────────

export interface FundingSourceInput {
  fromCategoryId: string;
  amountCents: Cents;
}

export interface ReallocationRow {
  fromCategoryId: string | null; // null = pool
  toCategoryId: string | null; // null = pool
  amountCents: Cents;
}

export type ReallocationError = { code: 'INVALID_FUNDING'; message: string };

export type ReallocationResult =
  | {
      ok: true;
      /** Planned-amount deltas to apply atomically, including the target. */
      plannedDeltas: { categoryId: string; deltaCents: Cents }[];
      /** Rows for the month's reallocation log. */
      rows: ReallocationRow[];
    }
  | { ok: false; error: ReallocationError };

/**
 * Build the atomic write set for a planned-amount change (SPEC §2.6). Category-to-category
 * moves leave SUM(planned) — and therefore the pool — unchanged; only the pool-funded part
 * moves it. Whatever funding doesn't cover comes from the pool, even past zero: planning
 * beyond income is allowed and shows as "Over budget" (owner, 2026-10-06).
 */
export function buildReallocation(
  change: AllocationChange,
  funding: readonly FundingSourceInput[],
  sourcePlanned: ReadonlyMap<string, Cents>,
): ReallocationResult {
  const delta =
    assertCents(change.newPlannedCents, 'newPlannedCents') -
    assertCents(change.oldPlannedCents, 'oldPlannedCents');
  const target = change.targetCategoryId;

  if (delta <= 0) {
    if (funding.length > 0) return invalid('funding is only valid when raising a planned amount');
    return {
      ok: true,
      plannedDeltas: delta === 0 ? [] : [{ categoryId: target, deltaCents: delta }],
      rows:
        delta === 0 ? [] : [{ fromCategoryId: target, toCategoryId: null, amountCents: -delta }],
    };
  }

  const seen = new Set<string>();
  for (const f of funding) {
    assertCents(f.amountCents, 'funding.amountCents');
    if (f.fromCategoryId === target) return invalid('a category cannot fund itself');
    if (seen.has(f.fromCategoryId)) return invalid(`duplicate source ${f.fromCategoryId}`);
    seen.add(f.fromCategoryId);
    if (f.amountCents <= 0) return invalid('funding amounts must be positive');
    const planned = sourcePlanned.get(f.fromCategoryId);
    if (planned === undefined) return invalid(`unknown source ${f.fromCategoryId}`);
    if (f.amountCents > planned) {
      return invalid(`${f.fromCategoryId} has only ${planned} planned`);
    }
  }

  const funded = sumCents(funding.map((f) => f.amountCents));
  if (funded > delta) return invalid('funding exceeds the increase');
  const fromPool = delta - funded;

  const rows: ReallocationRow[] = funding.map((f) => ({
    fromCategoryId: f.fromCategoryId,
    toCategoryId: target,
    amountCents: f.amountCents,
  }));
  if (fromPool > 0)
    rows.push({ fromCategoryId: null, toCategoryId: target, amountCents: fromPool });

  return {
    ok: true,
    plannedDeltas: [
      { categoryId: target, deltaCents: delta },
      ...funding.map((f) => ({ categoryId: f.fromCategoryId, deltaCents: -f.amountCents })),
    ],
    rows,
  };
}

function invalid(message: string): ReallocationResult {
  return { ok: false, error: { code: 'INVALID_FUNDING', message } };
}
