import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DetailPage } from '../components/detail/DetailPage';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { Chevron, EditRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { api } from '../lib/api';
import { shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useAccounts, useCashToPayday, useMe } from '../lib/queries';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
  annual: 'Every year',
  semimonthly: 'Twice a month',
};

/** Balance by day to payday, the lowest point marked. A single day has no shape to show. */
function Shape({
  points,
  lowestDate,
}: {
  points: { date: string; balanceCents: number }[];
  lowestDate: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.balanceCents), 1);
  return (
    <figure className="m-0">
      <div className="flex h-24 items-end gap-1.5 border-b border-hairline">
        {points.map((p, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${p.date === lowestDate ? 'bg-gold' : 'bg-sage-600'}`}
            style={{ height: `${Math.max(4, (p.balanceCents / max) * 100)}%` }}
          >
            <span className="sr-only">
              {shortDate(p.date)}: {formatCents(p.balanceCents)}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex gap-1.5">
        {points.map((p, i) => (
          <span key={i} className="flex-1 text-center type-caption text-ink-faint">
            {shortDate(p.date)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function CashAccountsSheet({
  open,
  onClose,
  selectedIds,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
}) {
  const accounts = useAccounts();
  const qc = useQueryClient();
  const [ids, setIds] = useState(selectedIds);
  const patch = useMutation({
    mutationFn: (cashAccountIds: string[]) => api('PATCH', '/me/settings', { cashAccountIds }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['cash-to-payday'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]),
  });
  const depository = (accounts.data ?? []).filter(
    (a) => a.kind === 'depository' && a.includeInBudget && !a.archivedAt,
  );
  return (
    <Sheet
      open={open}
      title="Cash accounts"
      onClose={onClose}
      action={{
        label: 'Save',
        onClick: () => {
          patch.mutate(ids);
          onClose();
        },
      }}
    >
      <p className="type-caption text-ink-muted">
        Which checking accounts count as cash for this projection. None selected uses every checking
        account.
      </p>
      <ul className="mt-3 divide-y divide-hairline rounded-card bg-surface shadow-soft">
        {depository.map((a) => (
          <li key={a.id} className="flex min-h-13 items-center justify-between gap-3 px-4 py-3">
            <span>{a.name}</span>
            <Toggle
              label={a.name}
              on={ids.includes(a.id)}
              onChange={(on) =>
                setIds((prev) => (on ? [...prev, a.id] : prev.filter((id) => id !== a.id)))
              }
            />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Cash-to-payday: how much of today's checking balance is free to move (SPEC: no autopay). */
export function CashToPayday() {
  const { data, isPending } = useCashToPayday();
  const me = useMe();
  const qc = useQueryClient();
  const [pickingAccounts, setPickingAccounts] = useState(false);
  const patch = useMutation({
    mutationFn: (cushionCents: number) => api('PATCH', '/me/settings', { cushionCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] }),
  });
  // Only the Dashboard links here (routes/table.ts).
  const back = { label: 'Dashboard', to: '/' };

  if (isPending || !data) {
    return (
      <DetailPage
        header={{ back, title: 'Cash to payday' }}
        identity={{ label: 'Free to move right now', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }

  // C4: with no pay schedule detected yet, the projection has nothing real to anchor on —
  // showing a number here would look precise while being a guess built on nothing.
  const noPaySchedule = data.paySchedules.length === 0;

  return (
    <DetailPage
      header={{ back, title: 'Cash to payday' }}
      identity={{
        label: 'Free to move right now',
        hero: noPaySchedule ? (
          <span className="text-2xl font-semibold text-ink-muted">Confirm your pay dates</span>
        ) : (
          <MoneyText cents={data.freeToMoveCents} whole />
        ),
        context: noPaySchedule ? (
          "No pay schedule found yet — this needs at least one paycheck in Rise's history."
        ) : data.lowestPoint.date !== data.points[0]?.date ? (
          <>
            Lowest point is <strong className="text-ink">{shortDate(data.lowestPoint.date)}</strong>
            , after {data.lowestPoint.label}.
          </>
        ) : undefined,
      }}
      shape={
        noPaySchedule ? undefined : (
          <Shape points={data.points} lowestDate={data.lowestPoint.date} />
        )
      }
      facts={
        <>
          <button
            type="button"
            onClick={() => setPickingAccounts(true)}
            className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-hairline py-3 text-left active:bg-sage-100"
          >
            <span className="text-ink">Cash accounts</span>
            <span className="flex items-center gap-2 text-ink-muted">
              {data.cashAccounts.map((a) => a.name).join(', ') || 'All checking'}
              <Chevron />
            </span>
          </button>
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
          <CashAccountsSheet
            open={pickingAccounts}
            onClose={() => setPickingAccounts(false)}
            selectedIds={me.data?.settings.cashAccountIds ?? []}
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
                    <div key={s.merchant} className="border-b border-hairline py-3">
                      <div className="flex justify-between gap-4">
                        <span className="font-medium">{s.displayName}</span>
                        <MoneyText cents={-s.series.expectedAmountCents} tone="in" />
                      </div>
                      <p className="mt-0.5 type-caption text-ink-faint">
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
