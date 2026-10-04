import { dayNumber } from '../networth';
import {
  firstUpcoming,
  parts,
  projectOccurrences,
  type DetectedSeries,
  type ProjectedOccurrence,
} from './detect';
import { CYCLE_DAYS } from './miss';

/**
 * The next `count` times a Surplus schedule moves cash, from today on. Pure.
 *
 * A schedule's stored date can be behind today: sync only moves it on when the real charge
 * posts, and a hand-added one has no charge to wait for. Dropping a past date would quietly
 * drop the money with it, so:
 *
 * - hand-added (`waitsForCharge` false): a past date already happened; it walks on to today.
 * - waiting on its real charge: a late bill hasn't left checking yet, so it counts today,
 *   until it posts or a whole cycle passes (then the missed-charge note is the signal). A late
 *   paycheck isn't counted until it lands. Either way the later dates still follow.
 */
export function upcomingOccurrences(
  series: DetectedSeries,
  today: string,
  count: number,
  waitsForCharge: boolean,
): ProjectedOccurrence[] {
  if (series.nextExpectedDate >= today) return projectOccurrences(series, count);
  // Walking on keeps the stored date's day of month (a 31st stays the 31st after February).
  const day = parts(series.nextExpectedDate).d;
  const anchorDays = series.anchorDays ?? ([day, day] as [number, number]);
  const rolled = {
    ...series,
    anchorDays,
    nextExpectedDate: firstUpcoming(series.cadence, series.nextExpectedDate, anchorDays, today),
  };
  const late = dayNumber(today) - dayNumber(series.nextExpectedDate);
  const owed =
    waitsForCharge && series.expectedAmountCents > 0 && late < CYCLE_DAYS[series.cadence];
  if (!owed) return projectOccurrences(rolled, count);
  return [
    { date: today, amountCents: series.expectedAmountCents },
    ...projectOccurrences(rolled, count - 1),
  ];
}
