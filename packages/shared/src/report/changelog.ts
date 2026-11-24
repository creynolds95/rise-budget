/**
 * "What's new" for the monthly report: a short, hand-kept list of user-visible changes by
 * date. Add a line when something ships that the owner would notice. The report passes the
 * month's entries to the narrative; a month with none says nothing.
 */
export interface ChangelogEntry {
  /** ISO date the change shipped. */
  date: string;
  text: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-11-20',
    text: 'Activity log: edits, syncs and performance are recorded for review.',
  },
  { date: '2026-11-24', text: 'Monthly report with charts and a short written summary.' },
];

export function changelogFor(month: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => e.date.startsWith(month));
}
