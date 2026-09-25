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

// ── money flow (Sankey) ────────────────────────────────────────────────────────────

export interface MoneyFlowCategoryInput {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  groupKind: 'income' | 'expense';
  /** `period_aggregate`'s convention: negative for income received, positive for spending. */
  spentCents: Cents;
}

export interface MoneyFlowNode {
  id: string;
  name: string;
}

export interface MoneyFlowLink {
  source: string;
  target: string;
  valueCents: Cents;
}

export interface MoneyFlow {
  nodes: MoneyFlowNode[];
  links: MoneyFlowLink[];
}

/**
 * Income categories → a single "Income" node → expense groups → expense categories, plus
 * whatever wasn't spent as a final "Left over" link. Pure shaping only — the caller filters
 * to budgeted categories and excludes dropped transactions (same rule as the rest of
 * reporting, `aggregates.ts`).
 */
export function buildMoneyFlow(categories: readonly MoneyFlowCategoryInput[]): MoneyFlow {
  const nodes = new Map<string, MoneyFlowNode>();
  const addNode = (id: string, name: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, name });
  };
  addNode('income', 'Income');

  const links: MoneyFlowLink[] = [];
  let totalIncome: Cents = 0;
  for (const c of categories) {
    if (c.groupKind !== 'income') continue;
    const earnedCents = -c.spentCents;
    if (earnedCents <= 0) continue;
    const id = `cat:${c.categoryId}`;
    addNode(id, c.categoryName);
    links.push({ source: id, target: 'income', valueCents: earnedCents });
    totalIncome = sumCents([totalIncome, earnedCents]);
  }

  const groupTotals = new Map<string, Cents>();
  let totalExpense: Cents = 0;
  for (const c of categories) {
    if (c.groupKind !== 'expense' || c.spentCents <= 0) continue;
    const groupNodeId = `group:${c.groupId}`;
    const catNodeId = `cat:${c.categoryId}`;
    addNode(groupNodeId, c.groupName);
    addNode(catNodeId, c.categoryName);
    links.push({ source: groupNodeId, target: catNodeId, valueCents: c.spentCents });
    groupTotals.set(groupNodeId, sumCents([groupTotals.get(groupNodeId) ?? 0, c.spentCents]));
    totalExpense = sumCents([totalExpense, c.spentCents]);
  }
  for (const [groupNodeId, total] of groupTotals) {
    links.unshift({ source: 'income', target: groupNodeId, valueCents: total });
  }

  const leftoverCents = totalIncome - totalExpense;
  if (leftoverCents > 0) {
    addNode('leftover', 'Left over');
    links.push({ source: 'income', target: 'leftover', valueCents: leftoverCents as Cents });
  }

  return { nodes: [...nodes.values()], links };
}
