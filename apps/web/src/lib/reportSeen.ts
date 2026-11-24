/**
 * Which monthly reports this login has opened or dismissed (the Dashboard card is per device,
 * like the other dismissible notes). Months only: nothing about the report itself.
 */
const KEY = 'rise.seenMonthlyReports';

export function seenReports(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function markReportSeen(month: string): void {
  const seen = seenReports();
  if (seen.includes(month)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen, month].slice(-24)));
  } catch {
    /* storage unavailable: the card shows again next visit */
  }
}

/** The card's text and link, or null when there is nothing to show. */
export function reportCard(
  ready: { month: string } | null | undefined,
  seen: readonly string[],
  monthLabel: (month: string) => string,
): { text: string; to: string } | null {
  if (!ready || seen.includes(ready.month)) return null;
  return {
    text: `Your ${monthLabel(ready.month)} report is ready`,
    to: `/settings/reports?m=${ready.month}&view=monthly&from=Dashboard|/`,
  };
}
