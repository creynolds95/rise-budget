/** Today as `YYYY-MM-DD` in the user's timezone (SPEC: dates are local, America/Chicago). */
export function localToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
