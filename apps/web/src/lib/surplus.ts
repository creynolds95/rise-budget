/** Surplus is green, a shortfall is clay (the app's red); zero reads as plain ink. */
export const surplusTone = (cents: number) => (cents > 0 ? 'in' : cents < 0 ? 'over' : 'ink');

export interface DayItem {
  label: string;
  cents: number;
}

export interface Day {
  date: string;
  /** End-of-day balance: after every event dated that day. */
  balanceCents: number;
  /** Charges that day (negative cents), largest first. */
  charges: DayItem[];
  /** Income that day (positive cents), largest first. */
  income: DayItem[];
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The projection's event points folded into one entry per day. Point 0 is today's balance
 * before any event; each later point is the running balance after one event, so an event's own
 * amount is the step from the point before it.
 */
export function dailySeries(
  points: { date: string; balanceCents: number; label: string }[],
  days = 14,
): Day[] {
  const first = points[0];
  if (!first) return [];
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first.date, i);
    let balanceCents = first.balanceCents;
    const charges: DayItem[] = [];
    const income: DayItem[] = [];
    for (let k = 1; k < points.length; k++) {
      const p = points[k];
      const prev = points[k - 1];
      if (!p || !prev || p.date > date) break;
      balanceCents = p.balanceCents;
      if (p.date !== date) continue;
      const cents = p.balanceCents - prev.balanceCents;
      (cents < 0 ? charges : income).push({ label: p.label, cents });
    }
    charges.sort((a, b) => a.cents - b.cents);
    income.sort((a, b) => b.cents - a.cents);
    return { date, balanceCents, charges, income };
  });
}

/** Tooltip lines: at most `max` rows, charges then income, the rest folded into a count. */
export function tooltipLines(day: Day, max = 3) {
  const all = [...day.charges, ...day.income];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
