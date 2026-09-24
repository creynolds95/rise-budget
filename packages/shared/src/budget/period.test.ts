import { describe, expect, it } from 'vitest';
import {
  addPeriods,
  comparePeriods,
  daysInPeriod,
  hasEnded,
  isLeapYear,
  makePeriodId,
  nextPeriod,
  pace,
  parseIsoDate,
  parsePeriodId,
  PeriodError,
  periodEnd,
  periodOf,
  periodStart,
  prevPeriod,
} from './period';

describe('period ids', () => {
  it('parses and formats', () => {
    expect(parsePeriodId('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(makePeriodId(26, 1)).toBe('0026-01');
    expect(() => parsePeriodId('2026-13')).toThrow(PeriodError);
    expect(() => parsePeriodId('2026-9')).toThrow(PeriodError);
  });

  it('knows leap years and month lengths', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(daysInPeriod('2024-02')).toBe(29);
    expect(daysInPeriod('2026-02')).toBe(28);
    expect(daysInPeriod('2026-09')).toBe(30);
    expect(daysInPeriod('2026-12')).toBe(31);
  });

  it('does arithmetic across year boundaries', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(prevPeriod('2026-01')).toBe('2025-12');
    expect(addPeriods('2026-09', -21)).toBe('2024-12');
    expect(comparePeriods('2026-09', '2026-10')).toBe(-1);
    expect(comparePeriods('2026-10', '2026-09')).toBe(1);
    expect(comparePeriods('2026-09', '2026-09')).toBe(0);
    expect(() => comparePeriods('x', '2026-09')).toThrow(PeriodError);
  });
});

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(() => parseIsoDate('2026-02-29')).toThrow(PeriodError);
    expect(() => parseIsoDate('2026-9-1')).toThrow(PeriodError);
    expect(periodOf('2026-09-23')).toBe('2026-09');
    expect(periodStart('2026-09')).toBe('2026-09-01');
    expect(periodEnd('2026-02')).toBe('2026-02-28');
  });

  it('knows when a period has ended', () => {
    expect(hasEnded('2026-09', '2026-09-30')).toBe(false);
    expect(hasEnded('2026-09', '2026-10-01')).toBe(true);
  });
});

describe('pace', () => {
  it('is an exact rational clamped to the period', () => {
    expect(pace('2026-09', '2026-08-31')).toEqual({ elapsedDays: 0, totalDays: 30 });
    expect(pace('2026-09', '2026-09-01')).toEqual({ elapsedDays: 1, totalDays: 30 });
    expect(pace('2026-09', '2026-09-15')).toEqual({ elapsedDays: 15, totalDays: 30 });
    expect(pace('2026-09', '2026-11-02')).toEqual({ elapsedDays: 30, totalDays: 30 });
  });
});
