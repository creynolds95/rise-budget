import type { SpendShape } from '../schemas/enums';
import { categoryMath } from './category';
import { assertCents, mulDiv, sumCents, type Cents } from './money';
import type { Pace } from './period';

// ── slack (SPEC §2.6) ─────────────────────────────────────────────────────────

export interface SlackInput {
  categoryId: string;
  spendShape: SpendShape;
  carriedInCents: Cents;
  plannedCents: Cents;
  spentCents: Cents;
  billPosted: boolean;
}

/**
 * slack = remaining − projected_remaining_spend.
 *   fixed:  projected = 0 if the bill has posted, else planned − spent
 *   linear: projected = available × (1 − pace)
 */
export function slack(c: SlackInput, p: Pace): Cents {
  const { availableCents, remainingCents } = categoryMath(c);
  const projected =
    c.spendShape === 'fixed'
      ? c.billPosted
        ? 0
        : c.plannedCents - c.spentCents
      : mulDiv(availableCents, p.totalDays - p.elapsedDays, p.totalDays);
  return remainingCents - projected;
}

export interface FundingCandidate {
  categoryId: string;
  slackCents: Cents;
}

/** Ranked by slack descending; excludes the target and anything with slack ≤ 0. */
export function rankFundingCandidates(
  targetCategoryId: string,
  categories: readonly SlackInput[],
  p: Pace,
): FundingCandidate[] {
  return categories
    .filter((c) => c.categoryId !== targetCategoryId)
    .map((c) => ({ categoryId: c.categoryId, slackCents: slack(c, p) }))
    .filter((c) => c.slackCents > 0)
    .sort((a, b) =>
      b.slackCents !== a.slackCents
        ? b.slackCents - a.slackCents
        : a.categoryId < b.categoryId
          ? -1
          : 1,
    );
}

// ── planning a planned-amount change ──────────────────────────────────────────

export interface AllocationChange {
  targetCategoryId: string;
  oldPlannedCents: Cents;
  newPlannedCents: Cents;
  poolCents: Cents;
}

export type AllocationPlan =
  | { kind: 'direct'; deltaCents: Cents }
  | {
      kind: 'needs_funding';
      deltaCents: Cents;
      shortfallCents: Cents;
      candidates: FundingCandidate[];
    };

/**
 * SPEC §2.6. Lowering, or raising within the pool, applies directly. Raising beyond the
 * pool REQUIRES a funding source before committing (edge 8). Any positive pool still
 * covers part of the raise; the shortfall is what must come from other categories.
 */
export function planAllocationChange(
  change: AllocationChange,
  categories: readonly SlackInput[],
  p: Pace,
): AllocationPlan {
  const delta =
    assertCents(change.newPlannedCents, 'newPlannedCents') -
    assertCents(change.oldPlannedCents, 'oldPlannedCents');
  const poolCents = assertCents(change.poolCents, 'poolCents');
  if (delta <= poolCents) return { kind: 'direct', deltaCents: delta };
  return {
    kind: 'needs_funding',
    deltaCents: delta,
    shortfallCents: delta - Math.max(poolCents, 0),
    candidates: rankFundingCandidates(change.targetCategoryId, categories, p),
  };
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

export type ReallocationError =
  | { code: 'INSUFFICIENT_POOL'; shortfallCents: Cents }
  | { code: 'INVALID_FUNDING'; message: string };

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
 * Build the atomic write set for a planned-amount change. Category-to-category moves leave
 * SUM(planned) — and therefore the pool — unchanged; only the pool-funded part moves it.
 * Funding may exceed the shortfall; the excess stays in the target and the pool pays less.
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
  const poolAvailable = Math.max(assertCents(change.poolCents, 'poolCents'), 0);
  if (fromPool > poolAvailable) {
    return {
      ok: false,
      error: { code: 'INSUFFICIENT_POOL', shortfallCents: fromPool - poolAvailable },
    };
  }

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
