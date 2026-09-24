import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DetailPage } from '../components/detail/DetailPage';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { api } from '../lib/api';
import { shortDate } from '../lib/dates';
import { useCashToPayday } from '../lib/queries';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
  annual: 'Every year',
  semimonthly: 'Twice a month',
};

function Shape({
  points,
  lowestDate,
}: {
  points: { date: string; balanceCents: number }[];
  lowestDate: string;
}) {
  const max = Math.max(...points.map((p) => p.balanceCents), 1);
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex h-20 items-end gap-1.5">
        {points.map((p, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${p.date === lowestDate ? 'bg-clay/40' : 'bg-sage-600'}`}
            style={{ height: `${Math.max(8, (p.balanceCents / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {points.map((p, i) => (
          <div key={i} className="flex-1 text-center">
            <p className="type-caption text-ink-faint">{shortDate(p.date)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cash-to-payday: how much of today's checking balance is free to move (SPEC: no autopay). */
export function CashToPayday() {
  const { data, isPending } = useCashToPayday();
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (cushionCents: number) => api('PATCH', '/me/settings', { cushionCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] }),
  });
  const back = { label: 'Budget', to: '/budget' };

  if (isPending || !data) {
    return (
      <DetailPage
        header={{ back, title: 'Cash to payday' }}
        identity={{ label: 'Free to move right now', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }

  return (
    <DetailPage
      header={{ back, title: 'Cash to payday' }}
      identity={{
        label: 'Free to move right now',
        hero: <MoneyText cents={data.freeToMoveCents} whole />,
        context:
          data.lowestPoint.date !== data.points[0]?.date ? (
            <>
              Lowest point is{' '}
              <strong className="text-ink">{shortDate(data.lowestPoint.date)}</strong>, after{' '}
              {data.lowestPoint.label}.
            </>
          ) : undefined,
      }}
      shape={<Shape points={data.points} lowestDate={data.lowestPoint.date} />}
      facts={
        <>
          <StaticRow
            label="Cash accounts"
            value={data.cashAccounts.map((a) => a.name).join(', ') || 'None'}
          />
          <EditRow
            label="Cushion held back"
            field={
              <MoneyField
                label="Cushion held back"
                cents={data.cushionCents}
                onCommit={(v) => patch.mutate(v)}
              />
            }
          />
        </>
      }
      related={
        data.paySchedules.length > 0
          ? {
              title: `Pay schedules detected (${data.paySchedules.length})`,
              children: (
                <>
                  {data.paySchedules.map((s) => (
                    <div
                      key={s.merchant}
                      className="rounded-card border border-hairline bg-surface p-3.5 mb-2.5"
                    >
                      <div className="flex justify-between">
                        <span className="font-semibold">{s.displayName}</span>
                        <MoneyText cents={-s.series.expectedAmountCents} tone="in" />
                      </div>
                      <p className="mt-1 type-caption text-ink-faint">
                        {CADENCE_LABEL[s.series.cadence] ?? s.series.cadence} · next{' '}
                        {shortDate(s.series.nextExpectedDate)}
                      </p>
                    </div>
                  ))}
                </>
              ),
            }
          : undefined
      }
    />
  );
}
