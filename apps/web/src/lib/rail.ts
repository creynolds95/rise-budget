/**
 * The budget rail's geometry (DESIGN-SYSTEM.md §6), in percent of the rail's width.
 * Three segments and one marker, no more:
 * - carried: tinted clay when negative (the category starts underwater), sage when positive;
 * - allocated: the rest of what's available;
 * - spent: fills from where available money starts, turning clay past available;
 * - the pace tick, only for linear categories.
 *
 * A negative carry is money already spoken for, so spending starts after it.
 */
export interface RailInput {
  carriedInCents: number;
  plannedCents: number;
  spentCents: number;
  /** Pace fraction as a rational, or null for fixed-shape categories (no tick). */
  tick: { elapsedDays: number; totalDays: number } | null;
}

export interface Span {
  start: number;
  width: number;
}

export interface RailGeometry {
  carried: (Span & { tone: 'deficit' | 'credit' }) | null;
  allocated: Span;
  spent: Span;
  over: Span | null;
  tick: number | null;
}

export function railGeometry(r: RailInput): RailGeometry {
  const debt = Math.max(-r.carriedInCents, 0);
  const credit = Math.max(r.carriedInCents, 0);
  const available = r.carriedInCents + r.plannedCents;
  const spentStart = debt;
  const availableEnd = spentStart + Math.max(available, 0);
  const spentEnd = spentStart + Math.max(r.spentCents, 0);
  const scale = Math.max(availableEnd, spentEnd, debt, credit, 1);
  const pct = (x: number) => (x / scale) * 100;
  const span = (a: number, b: number): Span => ({ start: pct(a), width: pct(Math.max(b - a, 0)) });

  const carried =
    debt > 0
      ? { ...span(0, debt), tone: 'deficit' as const }
      : credit > 0
        ? { ...span(0, credit), tone: 'credit' as const }
        : null;
  const allocStart = debt > 0 ? debt : credit;
  return {
    carried,
    allocated: span(allocStart, Math.max(availableEnd, allocStart)),
    spent: span(spentStart, Math.min(spentEnd, availableEnd)),
    over: spentEnd > availableEnd ? span(Math.max(availableEnd, spentStart), spentEnd) : null,
    tick:
      r.tick && available > 0 && r.tick.totalDays > 0
        ? pct(spentStart + (available * r.tick.elapsedDays) / r.tick.totalDays)
        : null,
  };
}
