import { mulDiv, sumCents, type Cents } from '../budget/money';
import {
  addPeriods,
  comparePeriods,
  daysInPeriod,
  parseIsoDate,
  periodOf,
  type IsoDate,
  type PeriodId,
} from '../budget/period';

/**
 * Dashboard reports (T41: "spend vs last month, reports scrolling in"). Pure. Spending here is
 * the same rule as the budget: splits in budgeted expense categories, dropped rows excluded —
 * the API does that filtering; these functions only shape the numbers.
 */

export interface DaySpend {
  date: IsoDate;
  cents: Cents;
}

export interface MonthSpend {
  periodId: PeriodId;
  cents: Cents;
}

/**
 * Running spending total for each day of `month`, index 0 = the 1st. Stops after
 * `throughDay` so a month in progress isn't drawn as flat into the future. Refunds stay
 * negative — they really do lower what was spent.
 */
export function cumulativeSpend(
  month: PeriodId,
  days: readonly DaySpend[],
  throughDay: number = daysInPeriod(month),
): Cents[] {
  const len = Math.max(0, Math.min(throughDay, daysInPeriod(month)));
  const perDay: Cents[] = Array.from({ length: len }, () => 0);
  for (const d of days) {
    if (periodOf(d.date) !== month) continue;
    const i = parseIsoDate(d.date).day - 1;
    if (i < len) perDay[i] = sumCents([perDay[i] as Cents, d.cents]);
  }
  let run = 0;
  return perDay.map((c) => (run = sumCents([run, c])));
}

/**
 * What had been spent by `day` in a month's running total — the fair comparison for a month
 * in progress. A shorter earlier month (February against the 31st) reads its last day.
 */
export function sameDayTotal(cumulative: readonly Cents[], day: number): Cents {
  if (day < 1 || cumulative.length === 0) return 0;
  return cumulative[Math.min(day, cumulative.length) - 1] as Cents;
}

/** One entry per month from `from` to `to` inclusive, oldest first; a quiet month is 0. */
export function monthlySeries(
  from: PeriodId,
  to: PeriodId,
  rows: readonly MonthSpend[],
): MonthSpend[] {
  const by = new Map(rows.map((r) => [r.periodId, r.cents]));
  const out: MonthSpend[] = [];
  for (let p = from; comparePeriods(p, to) <= 0; p = addPeriods(p, 1)) {
    out.push({ periodId: p, cents: by.get(p) ?? 0 });
  }
  return out;
}

/** Mean in whole cents, rounded half away from zero. Null when there is nothing to average. */
export function averageCents(values: readonly Cents[]): Cents | null {
  return values.length === 0 ? null : mulDiv(sumCents(values), 1, values.length);
}
