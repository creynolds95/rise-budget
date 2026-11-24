import { useEffect } from 'react';
import { markReportSeen } from '../lib/reportSeen';
import { MonthlyReportBody } from '../components/MonthlyReportBody';
import { Skeleton } from '../components/primitives/Skeleton';
import { useMonthlyReport, useSetMonthlyReport, useWriteMonthlySummary } from '../lib/queries';

/** The monthly report screen: the report for `month`, with the key-gated write controls. */
export function MonthlyReportView({ month }: { month: string }) {
  // Looking at it is enough: the Dashboard card for this month goes away.
  useEffect(() => markReportSeen(month), [month]);
  const q = useMonthlyReport(month);
  const write = useWriteMonthlySummary();
  const set = useSetMonthlyReport();
  if (!q.data) return <Skeleton className="mt-4 h-64 w-full" />;
  const { report, keySet, zip, lifeNotes } = q.data;
  const proposed = report.narrative?.lifeNote ?? '';
  // A note is offered once per month: kept or dismissed, it is not offered again.
  const decide = (status: 'kept' | 'dismissed') =>
    set.mutate({
      lifeNotes: [
        ...lifeNotes.filter((n) => n.month !== month),
        { month, text: proposed, status },
      ].slice(-12),
    });
  return (
    <MonthlyReportBody
      report={report}
      controls={
        keySet
          ? {
              keySet,
              writing: write.isPending,
              failed: write.isError,
              onWrite: () => write.mutate(month),
              zip,
              zipPending: set.isPending,
              onZip: (z) => set.mutate({ zip: z }),
              lifeNote:
                proposed && !lifeNotes.some((n) => n.month === month)
                  ? {
                      text: proposed,
                      pending: set.isPending,
                      onKeep: () => decide('kept'),
                      onDismiss: () => decide('dismissed'),
                    }
                  : null,
            }
          : undefined
      }
    />
  );
}
