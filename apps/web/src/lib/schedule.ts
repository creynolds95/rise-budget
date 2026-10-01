/** Declared paycheck/bill schedules: which days of the month, with 31 meaning the last day. */
export type Cadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';

export const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annually' },
];

export const LAST_DAY = 31;

/** 1 → "1st", 22 → "22nd", 31 (the last day) → "last day". */
export function dayName(n: number): string {
  if (n === LAST_DAY) return 'last day';
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${n % 10 > 3 ? 'th' : suffix}`;
}

export function describeSchedule(cadence: string, anchorDays: [number, number] | null): string {
  switch (cadence) {
    case 'weekly':
      return 'Every week';
    case 'biweekly':
      return 'Every two weeks';
    case 'annual':
      return 'Every year';
    case 'semimonthly':
      return anchorDays
        ? `Twice a month: ${dayName(anchorDays[0])} and ${dayName(anchorDays[1])}`
        : 'Twice a month';
    default:
      return anchorDays ? `Every month on the ${dayName(anchorDays[0])}` : 'Every month';
  }
}

/** The form state behind a schedule: a date for the cadences that need one, days for the rest. */
export interface ScheduleDraft {
  cadence: Cadence;
  anchorDate: string;
  day1: number;
  day2: number;
}

export function draftFrom(
  cadence: string,
  anchorDays: [number, number] | null,
  nextDate: string,
  fallback: { day1: number; day2: number } = { day1: 1, day2: 15 },
): ScheduleDraft {
  const known = CADENCE_OPTIONS.some((c) => c.value === cadence);
  const dayOfNext = Number(nextDate.slice(8, 10));
  return {
    cadence: known ? (cadence as Cadence) : 'monthly',
    anchorDate: nextDate,
    day1: anchorDays?.[0] ?? (cadence === 'monthly' ? dayOfNext : fallback.day1),
    day2: anchorDays?.[1] ?? fallback.day2,
  };
}

/** What the API takes: days for twice-a-month and monthly, a date for everything else. */
export function schedulePayload(d: ScheduleDraft): {
  cadence: Cadence;
  anchorDate: string;
  anchorDays?: [number, number];
} {
  if (d.cadence === 'semimonthly')
    return { cadence: d.cadence, anchorDate: d.anchorDate, anchorDays: [d.day1, d.day2] };
  if (d.cadence === 'monthly')
    return { cadence: d.cadence, anchorDate: d.anchorDate, anchorDays: [d.day1, d.day1] };
  return { cadence: d.cadence, anchorDate: d.anchorDate };
}
