import { beforeEach, describe, expect, it } from 'vitest';
import { markReportSeen, reportCard, seenReports } from './reportSeen';

const label = (m: string) => (m === '2026-10' ? 'October' : m);

describe('report card', () => {
  beforeEach(() => localStorage.clear());

  it('shows for a ready report and links to the Monthly tab', () => {
    expect(reportCard({ month: '2026-10' }, [], label)).toEqual({
      text: 'Your October report is ready',
      to: '/settings/reports?m=2026-10&view=monthly&from=Dashboard|/',
    });
    expect(reportCard(null, [], label)).toBeNull();
  });

  it('is gone once that month was opened or dismissed, but not for the next one', () => {
    markReportSeen('2026-10');
    markReportSeen('2026-10');
    expect(seenReports()).toEqual(['2026-10']);
    expect(reportCard({ month: '2026-10' }, seenReports(), label)).toBeNull();
    expect(reportCard({ month: '2026-11' }, seenReports(), label)?.text).toContain('2026-11');
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('rise.seenMonthlyReports', '{oops');
    expect(seenReports()).toEqual([]);
  });
});
