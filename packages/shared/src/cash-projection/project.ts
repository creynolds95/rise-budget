/**
 * Cash-to-payday projection. Pure. A rolling day-by-day checking balance from today's
 * balance plus known cash events — paychecks in, real auto-drafted bills out. Card
 * payments are never events here: with no autopay, paying a card is the user's own
 * decision, not a predictable outflow.
 */

export interface CashEvent {
  date: string;
  /** Positive = cash in (a paycheck), negative = cash out (a real auto-drafted bill). */
  cashDeltaCents: number;
  label: string;
}

export interface CashPoint {
  date: string;
  balanceCents: number;
  label: string;
}

export interface CashProjection {
  /** Today, then each event in date order, running balance. */
  points: CashPoint[];
  lowestPoint: CashPoint;
  /** How much of today's balance is free to move without dipping below the cushion. */
  freeToMoveCents: number;
}

export function projectCashFlow(
  startBalanceCents: number,
  today: string,
  cushionCents: number,
  events: readonly CashEvent[],
): CashProjection {
  const upcoming = [...events]
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const points: CashPoint[] = [{ date: today, balanceCents: startBalanceCents, label: 'Today' }];
  let running = startBalanceCents;
  for (const e of upcoming) {
    running += e.cashDeltaCents;
    points.push({ date: e.date, balanceCents: running, label: e.label });
  }
  const lowestPoint = points.reduce((min, p) => (p.balanceCents < min.balanceCents ? p : min));
  const freeToMoveCents = Math.max(0, lowestPoint.balanceCents - cushionCents);
  return { points, lowestPoint, freeToMoveCents };
}
