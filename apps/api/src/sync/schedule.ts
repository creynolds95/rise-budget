/** Cron fires every minute; the owner's chosen times decide which ticks actually sync. A skipped
 * tick is one small read and no writes. */
export const SYNC_CRON = '* * * * *';

/** Manual plus scheduled syncs stay under SimpleFIN's 24 requests a day. */
export const SYNC_DAILY_LIMIT = 20;

function localParts(at: Date, timeZone: string): { minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { minute: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday') };
}

/**
 * Whether this tick is one of the owner's sync times, and whether it is the weekly deep re-read
 * (the earliest chosen time on Sunday, local time).
 */
export function syncSlot(
  times: readonly number[],
  timeZone: string,
  at: Date,
): { due: boolean; deep: boolean } {
  const { minute, weekday } = localParts(at, timeZone);
  const due = times.includes(minute);
  return { due, deep: due && weekday === 'Sun' && minute === Math.min(...times) };
}
