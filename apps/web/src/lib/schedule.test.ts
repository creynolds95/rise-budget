import { describe, expect, it } from 'vitest';
import { dayName, describeSchedule, draftFrom, schedulePayload } from './schedule';

describe('schedule', () => {
  it('names days, with 31 as the last day', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 15, 21, 22, 23, 30, 31].map(dayName)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '15th',
      '21st',
      '22nd',
      '23rd',
      '30th',
      'last day',
    ]);
  });

  it('describes each cadence', () => {
    expect(describeSchedule('weekly', null)).toBe('Every week');
    expect(describeSchedule('biweekly', null)).toBe('Every two weeks');
    expect(describeSchedule('annual', null)).toBe('Every year');
    expect(describeSchedule('semimonthly', [15, 31])).toBe('Twice a month: 15th and last day');
    expect(describeSchedule('semimonthly', null)).toBe('Twice a month');
    expect(describeSchedule('monthly', [31, 31])).toBe('Every month on the last day');
    expect(describeSchedule('monthly', null)).toBe('Every month');
  });

  it('builds a draft from a stored schedule', () => {
    expect(draftFrom('semimonthly', [1, 15], '2026-10-15')).toEqual({
      cadence: 'semimonthly',
      anchorDate: '2026-10-15',
      day1: 1,
      day2: 15,
    });
    expect(draftFrom('monthly', null, '2026-10-20').day1).toBe(20);
    expect(draftFrom('weekly', null, '2026-10-20', { day1: 5, day2: 20 })).toMatchObject({
      day1: 5,
      day2: 20,
    });
    expect(draftFrom('mystery', null, '2026-10-20').cadence).toBe('monthly');
  });

  it('sends days for twice-a-month and monthly, a date otherwise', () => {
    const d = draftFrom('semimonthly', [15, 31], '2026-10-15');
    expect(schedulePayload(d).anchorDays).toEqual([15, 31]);
    expect(schedulePayload({ ...d, cadence: 'monthly', day1: 31 }).anchorDays).toEqual([31, 31]);
    expect(schedulePayload({ ...d, cadence: 'weekly' })).toEqual({
      cadence: 'weekly',
      anchorDate: '2026-10-15',
    });
  });
});
