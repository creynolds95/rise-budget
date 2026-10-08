/** Hourly cron; the owner's chosen hours decide which ticks actually sync. */
export const SYNC_CRON = '0 * * * *';

/** Manual plus scheduled syncs stay under SimpleFIN's 24 requests a day. */
export const SYNC_DAILY_LIMIT = 20;

function localParts(at: Date, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { hour: Number(get('hour')), weekday: get('weekday') };
}

/**
 * Whether this hourly tick is one of the owner's sync hours, and whether it is the weekly deep
 * re-read (the first chosen hour on Sunday, local time).
 */
export function syncSlot(
  hours: readonly number[],
  timeZone: string,
  at: Date,
): { due: boolean; deep: boolean } {
  const { hour, weekday } = localParts(at, timeZone);
  const due = hours.includes(hour);
  return { due, deep: due && weekday === 'Sun' && hour === Math.min(...hours) };
}
