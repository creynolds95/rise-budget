import { addMonths } from './dates';

export interface MonthSpend {
  periodId: string;
  spentCents: number;
}

export interface PlanStats {
  /** The six months before the one being planned, oldest first. */
  bars: MonthSpend[];
  lastMonthCents: number;
  /** Average over months since spending began (at most six), or null with no history. */
  averageCents: number | null;
}

/** Round a suggestion up to whole dollars: plans are made in dollars, and up is the safe side. */
export const upToDollar = (cents: number) => Math.ceil(Math.max(cents, 0) / 100) * 100;

/** What the plan editor shows beside the amount: recent spending, last month, the average. */
export function planStats(history: MonthSpend[], month: string): PlanStats {
  const byId = new Map(history.map((h) => [h.periodId, h.spentCents]));
  const bars = [6, 5, 4, 3, 2, 1].map((n) => {
    const periodId = addMonths(month, -n);
    return { periodId, spentCents: byId.get(periodId) ?? 0 };
  });
  const first = bars.findIndex((b) => b.spentCents !== 0);
  const active = first === -1 ? [] : bars.slice(first);
  const sum = active.reduce((n, b) => n + b.spentCents, 0);
  return {
    bars,
    lastMonthCents: bars[5]?.spentCents ?? 0,
    averageCents: active.length ? Math.round(sum / active.length) : null,
  };
}
