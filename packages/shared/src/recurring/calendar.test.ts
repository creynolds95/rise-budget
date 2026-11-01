import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  earliestMatch,
  fedHolidays,
  isBusinessDay,
  nextBusinessDay,
  overdueByBusinessDay,
  prevBusinessDay,
} from './calendar';

describe('Federal Reserve holidays', () => {
  it('lists the 11 observed days of 2026', () => {
    expect([...fedHolidays(2026)].sort()).toEqual(
      [
        '2026-01-01',
        '2026-01-19',
        '2026-02-16',
        '2026-05-25',
        '2026-06-19',
        '2026-09-07',
        '2026-10-12',
        '2026-11-11',
        '2026-11-26',
        '2026-12-25',
      ].sort(),
    );
  });

  it('a holiday on Saturday is not observed (July 4 2026): Friday stays open', () => {
    expect(isBusinessDay('2026-07-03')).toBe(true);
    expect(isBusinessDay('2026-07-04')).toBe(false); // the weekend itself
  });

  it('a holiday on Sunday is observed Monday (Jan 1 2023 -> Jan 2; Jul 4 2027 -> Jul 5)', () => {
    expect(fedHolidays(2023).has('2023-01-02')).toBe(true);
    expect(isBusinessDay('2023-01-02')).toBe(false);
    expect(isBusinessDay('2027-07-05')).toBe(false);
    expect(nextBusinessDay('2027-07-04')).toBe('2027-07-06');
  });

  it('New Year 2028 is a Saturday: not observed, Dec 31 2027 stays open', () => {
    expect(isBusinessDay('2027-12-31')).toBe(true);
  });

  it('floating holidays land on the right weekday', () => {
    expect(fedHolidays(2027).has('2027-01-18')).toBe(true); // MLK, 3rd Monday
    expect(fedHolidays(2027).has('2027-05-31')).toBe(true); // Memorial, last Monday
    expect(fedHolidays(2027).has('2027-11-25')).toBe(true); // Thanksgiving, 4th Thursday
    expect(fedHolidays(2026).has('2026-05-25')).toBe(true);
  });
});

describe('business-day moves', () => {
  it('a weekend bill goes to Monday; a holiday Monday pushes it to Tuesday', () => {
    expect(nextBusinessDay('2026-10-31')).toBe('2026-11-02'); // Saturday
    expect(nextBusinessDay('2026-09-05')).toBe('2026-09-08'); // Saturday before Labor Day
    expect(nextBusinessDay('2026-11-11')).toBe('2026-11-12'); // Veterans Day, Wednesday
  });

  it('a weekend paycheck goes to the Friday before; a holiday Friday pushes to Thursday', () => {
    expect(prevBusinessDay('2026-11-01')).toBe('2026-10-30'); // Sunday
    expect(prevBusinessDay('2026-06-20')).toBe('2026-06-18'); // Fri 19th is Juneteenth
    expect(prevBusinessDay('2026-12-25')).toBe('2026-12-24');
  });

  it('a business day stays put', () => {
    expect(nextBusinessDay('2026-10-28')).toBe('2026-10-28');
    expect(prevBusinessDay('2026-10-28')).toBe('2026-10-28');
  });

  it('counts business days across weekends and holidays', () => {
    expect(addBusinessDays('2026-09-08', -2)).toBe('2026-09-03'); // skips Labor Day + weekend
    expect(addBusinessDays('2026-10-30', 1)).toBe('2026-11-02');
    expect(addBusinessDays('2026-10-30', 0)).toBe('2026-10-30');
  });

  it('year end: Dec 31 2026 + 1 business day is Jan 4 2027 (Jan 1 holiday, weekend)', () => {
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-04');
    expect(nextBusinessDay('2027-01-01')).toBe('2027-01-04');
  });
});

describe('earliestMatch', () => {
  it('a bill is never early beyond a day of slack', () => {
    expect(earliestMatch('2026-10-12', false)).toBe('2026-10-11');
  });

  it('a paycheck is 2 business days early by default, up to a cap of 3', () => {
    expect(earliestMatch('2026-10-13', true)).toBe('2026-10-08'); // Tue -> Thu (Columbus Mon)
    expect(earliestMatch('2026-10-13', true, 3)).toBe('2026-10-07');
    expect(earliestMatch('2026-10-13', true, 9)).toBe('2026-10-07');
  });
});

describe('overdueByBusinessDay', () => {
  it('a Saturday bill is taken Monday and is not overdue until after Tuesday', () => {
    expect(overdueByBusinessDay('2026-10-31', '2026-11-02')).toBe(false);
    expect(overdueByBusinessDay('2026-10-31', '2026-11-03')).toBe(false);
    expect(overdueByBusinessDay('2026-10-31', '2026-11-04')).toBe(true);
  });

  it('a holiday Monday adds a day (Labor Day bill: due Tue, overdue after Wed)', () => {
    expect(overdueByBusinessDay('2026-09-07', '2026-09-09')).toBe(false);
    expect(overdueByBusinessDay('2026-09-07', '2026-09-10')).toBe(true);
  });
});
