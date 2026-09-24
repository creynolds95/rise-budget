/**
 * Periods are calendar months identified as `YYYY-MM` (SPEC §0). Dates are local
 * `YYYY-MM-DD` strings. Everything here is pure calendar arithmetic — no clocks.
 */

import type { IsoDate, PeriodId } from '../schemas/primitives';

export type { IsoDate, PeriodId };

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class PeriodError extends Error {
  override readonly name = 'PeriodError';
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function parsePeriodId(id: PeriodId): { year: number; month: number } {
  const m = PERIOD_RE.exec(id);
  if (!m) throw new PeriodError(`invalid period id: ${id}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function makePeriodId(year: number, month: number): PeriodId {
  return `${pad(year, 4)}-${pad(month, 2)}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInPeriod(id: PeriodId): number {
  const { year, month } = parsePeriodId(id);
  return month === 2 && isLeapYear(year) ? 29 : (DAYS[month - 1] as number);
}

export function addPeriods(id: PeriodId, n: number): PeriodId {
  const { year, month } = parsePeriodId(id);
  const idx = year * 12 + (month - 1) + n;
  return makePeriodId(Math.floor(idx / 12), (idx % 12) + 1);
}

export const nextPeriod = (id: PeriodId): PeriodId => addPeriods(id, 1);
export const prevPeriod = (id: PeriodId): PeriodId => addPeriods(id, -1);

export function comparePeriods(a: PeriodId, b: PeriodId): number {
  parsePeriodId(a);
  parsePeriodId(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseIsoDate(d: IsoDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(d);
  if (!m) throw new PeriodError(`invalid date: ${d}`);
  const out = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (out.day > daysInPeriod(makePeriodId(out.year, out.month))) {
    throw new PeriodError(`invalid date: ${d}`);
  }
  return out;
}

export function periodOf(date: IsoDate): PeriodId {
  const { year, month } = parseIsoDate(date);
  return makePeriodId(year, month);
}

export function periodStart(id: PeriodId): IsoDate {
  return `${id}-01`;
}

export function periodEnd(id: PeriodId): IsoDate {
  return `${id}-${pad(daysInPeriod(id), 2)}`;
}

/** True once the calendar month has fully ended as of `today`. */
export function hasEnded(id: PeriodId, today: IsoDate): boolean {
  parseIsoDate(today);
  return today > periodEnd(id);
}

/**
 * Pace as an exact rational `elapsedDays / totalDays` (SPEC §2.7), clamped to [0, total].
 * `today` counts as elapsed — on the last day of the month pace is 1.
 * `totalDays` is always ≥ 28, so consumers can never divide by zero (edge case 14).
 */
export interface Pace {
  elapsedDays: number;
  totalDays: number;
}

export function pace(id: PeriodId, today: IsoDate): Pace {
  const totalDays = daysInPeriod(id);
  parseIsoDate(today);
  if (today < periodStart(id)) return { elapsedDays: 0, totalDays };
  if (today > periodEnd(id)) return { elapsedDays: totalDays, totalDays };
  return { elapsedDays: parseIsoDate(today).day, totalDays };
}
