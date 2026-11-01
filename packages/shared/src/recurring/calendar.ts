import { dateFromDayNumber, dayNumber } from '../networth';

/**
 * Business days, the way the Federal Reserve keeps them. Pure, no dependency: the holidays
 * are worked out by rule. A bill due on a non-business day is taken the next business day; a
 * paycheck dated on one lands the business day before.
 *
 * Fed rule: a holiday on a Sunday is observed the Monday after; one on a Saturday is not
 * observed at all (the Friday before stays a business day).
 */

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 (day number 0) is a Thursday. */
export function weekday(dayNum: number): number {
  return (((dayNum + 4) % 7) + 7) % 7;
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The `n`th (1-based) given weekday of a month; `n = -1` is the last one. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = dayNumber(iso(y, m, 1));
    const offset = (wd - weekday(first) + 7) % 7;
    return dateFromDayNumber(first + offset + 7 * (n - 1));
  }
  const nextMonth = m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1);
  const last = dayNumber(nextMonth) - 1;
  return dateFromDayNumber(last - ((weekday(last) - wd + 7) % 7));
}

/** A fixed-date holiday as observed: Sunday moves to Monday, Saturday is not observed. */
function observed(y: number, m: number, d: number): string | null {
  const dn = dayNumber(iso(y, m, d));
  const wd = weekday(dn);
  if (wd === 6) return null;
  return wd === 0 ? dateFromDayNumber(dn + 1) : iso(y, m, d);
}

const cache = new Map<number, ReadonlySet<string>>();

/** The days the Federal Reserve is closed that fall in `y` (observed dates). */
export function fedHolidays(y: number): ReadonlySet<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const days = [
    observed(y, 1, 1),
    nthWeekday(y, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(y, 2, 1, 3), // Washington's Birthday
    nthWeekday(y, 5, 1, -1), // Memorial Day
    observed(y, 6, 19), // Juneteenth
    observed(y, 7, 4), // Independence Day
    nthWeekday(y, 9, 1, 1), // Labor Day
    nthWeekday(y, 10, 1, 2), // Columbus Day
    observed(y, 11, 11), // Veterans Day
    nthWeekday(y, 11, 4, 4), // Thanksgiving
    observed(y, 12, 25),
  ].filter((d): d is string => d !== null);
  // A Sunday New Year's Day of next year is observed Monday, still next year: nothing leaks
  // back. But a Saturday one is not observed, so the 31st of December stays open.
  const set = new Set(days);
  cache.set(y, set);
  return set;
}

export function isBusinessDay(date: string): boolean {
  const wd = weekday(dayNumber(date));
  if (wd === 0 || wd === 6) return false;
  return !fedHolidays(Number(date.slice(0, 4))).has(date);
}

/** `date` itself if it is a business day, else the next one. Bills move this way. */
export function nextBusinessDay(date: string): string {
  let dn = dayNumber(date);
  while (!isBusinessDay(dateFromDayNumber(dn))) dn++;
  return dateFromDayNumber(dn);
}

/** `date` itself if it is a business day, else the one before. Paychecks move this way. */
export function prevBusinessDay(date: string): string {
  let dn = dayNumber(date);
  while (!isBusinessDay(dateFromDayNumber(dn))) dn--;
  return dateFromDayNumber(dn);
}

/** `date` moved `n` business days (negative = earlier); it is first brought onto a business day. */
export function addBusinessDays(date: string, n: number): string {
  let dn = dayNumber(n < 0 ? prevBusinessDay(date) : nextBusinessDay(date));
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0;) {
    dn += step;
    if (isBusinessDay(dateFromDayNumber(dn))) left--;
  }
  return dateFromDayNumber(dn);
}

/** Business days a paycheck may land before its pay date. Each paycheck can learn up to the cap. */
export const PAYCHECK_EARLY_BUSINESS_DAYS = 2;
export const MAX_PAYCHECK_EARLY_BUSINESS_DAYS = 3;
/** Days a bill's charge may carry a date before its due date (a posted date can read a day early). */
export const BILL_EARLY_SLACK_DAYS = 1;

/**
 * The earliest date a charge can count as paying a schedule due `due`. A bill is never paid
 * early: one day of slack for a date that reads a day off. A paycheck may land up to
 * `earlyBusinessDays` business days before its pay date (after that date has been moved onto a
 * business day).
 */
export function earliestMatch(
  due: string,
  income: boolean,
  earlyBusinessDays: number = PAYCHECK_EARLY_BUSINESS_DAYS,
): string {
  return income
    ? addBusinessDays(due, -Math.min(earlyBusinessDays, MAX_PAYCHECK_EARLY_BUSINESS_DAYS))
    : dateFromDayNumber(dayNumber(due) - BILL_EARLY_SLACK_DAYS);
}
