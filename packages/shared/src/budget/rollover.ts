import type { RolloverPolicy } from '../schemas/enums';
import { categoryMath } from './category';
import { assertCents, type Cents } from './money';
import { nextPeriod, type PeriodId } from './period';

/**
 * Live rollover (Caleb, 2026-10-01). There is no closing: every month's carry-in is worked out
 * from the month before, so the 1st rolls over on its own and a late recategorisation flows
 * forward into every later month. The chain starts at `ROLLOVER_START`; nothing carries into
 * it or out of any month before it (those are history). Income never rolls: a month that
 * earned more or less than planned changes nothing about the next one.
 */
export const ROLLOVER_START: PeriodId = '2026-10';

/**
 * Only a `roll` category carries, surplus or deficit. Any other category starts every month
 * fresh: its leftover and its overspend both stay in the month they happened in.
 */
export function computeCarryOut(policy: RolloverPolicy, remainingCents: Cents): Cents {
  assertCents(remainingCents, 'remainingCents');
  return policy === 'roll' ? remainingCents : 0;
}

export interface MonthCategory {
  categoryId: string;
  rolloverPolicy: RolloverPolicy;
  carriedInCents: Cents;
  plannedCents: Cents;
  spentCents: Cents;
}

/** What one month passes to the next, per category. Expense categories only. */
export function computeMonthEnd(
  categories: readonly MonthCategory[],
): { categoryId: string; carriedInCents: Cents }[] {
  return categories.map((c) => ({
    categoryId: c.categoryId,
    carriedInCents: computeCarryOut(c.rolloverPolicy, categoryMath(c).remainingCents),
  }));
}

export interface ChainCategory {
  categoryId: string;
  rolloverPolicy: RolloverPolicy;
  plannedCents: Cents;
  spentCents: Cents;
  /** A forgiven deficit, added to this month's carry-in (SPEC §2.8). */
  adjustCents: Cents;
}

export interface ChainMonth {
  periodId: PeriodId;
  categories: readonly ChainCategory[];
}

export interface RolledInto {
  periodId: PeriodId;
  /** Carry-in per category for this month, adjustments included. */
  carriedIn: Map<string, Cents>;
}

/**
 * Walk the chain: what every month in `months` starts with. `months` runs from the chain start,
 * contiguous and ascending; the first month starts from nothing but its own adjustment. The
 * same categories should appear in every month.
 *
 * A month only rolls over once it has ended: months from `current` on pass nothing forward, so
 * every later month starts with the carry as of the last ended month (plus its own adjustment).
 * Unspent plans are never projected forward. Without `current`, every month counts as ended.
 */
export function rollChain(months: readonly ChainMonth[], current?: PeriodId): RolledInto[] {
  const out: RolledInto[] = [];
  let carried = new Map<string, Cents>();
  let expected = months[0]?.periodId;
  for (const m of months) {
    if (m.periodId !== expected) throw new RangeError(`expected ${expected}, got ${m.periodId}`);
    const withCarry = new Map(
      m.categories.map((c) => [
        c.categoryId,
        (carried.get(c.categoryId) ?? 0) + assertCents(c.adjustCents, 'adjustCents'),
      ]),
    );
    out.push({ periodId: m.periodId, carriedIn: withCarry });
    expected = nextPeriod(m.periodId);
    if (current !== undefined && m.periodId >= current) continue;
    carried = new Map(
      computeMonthEnd(
        m.categories.map((c) => ({
          categoryId: c.categoryId,
          rolloverPolicy: c.rolloverPolicy,
          carriedInCents: withCarry.get(c.categoryId) as Cents,
          plannedCents: c.plannedCents,
          spentCents: c.spentCents,
        })),
      ).map((c) => [c.categoryId, c.carriedInCents]),
    );
  }
  return out;
}
