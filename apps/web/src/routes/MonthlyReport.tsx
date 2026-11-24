import { MonthlyReportBody } from '../components/MonthlyReportBody';
import { Skeleton } from '../components/primitives/Skeleton';
import { useMonthlyReport, useSetMonthlyAuto, useWriteMonthlySummary } from '../lib/queries';

/** The monthly report screen: the report for `month`, with the key-gated write controls. */
export function MonthlyReportView({ month }: { month: string }) {
  const q = useMonthlyReport(month);
  const write = useWriteMonthlySummary();
  const auto = useSetMonthlyAuto();
  if (!q.data) return <Skeleton className="mt-4 h-64 w-full" />;
  const { report, keySet, auto: autoOn } = q.data;
  return (
    <MonthlyReportBody
      report={report}
      controls={
        keySet
          ? {
              keySet,
              autoOn,
              writing: write.isPending,
              failed: write.isError,
              autoPending: auto.isPending,
              onWrite: () => write.mutate(month),
              onAuto: (v) => auto.mutate(v),
            }
          : undefined
      }
    />
  );
}
