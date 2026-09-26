import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { Chevron, EditRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { ApiError, api } from '../lib/api';
import { localToday, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useAccounts, useCashToPayday, useManualCashEvents, useMe } from '../lib/queries';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
  annual: 'Every year',
  semimonthly: 'Twice a month',
};

const CADENCES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annually' },
] as const;

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

/** Add a hand-declared paycheck or bill — for a cold start, or income Rise hasn't seen post yet. */
function AddManualEventSheet({
  kind,
  onClose,
  onSaved,
}: {
  kind: 'income' | 'expense';
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const tz = useMe().data?.timezone;
  const [label, setLabel] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]['value']>('monthly');
  const [anchorDate, setAnchorDate] = useState(() => localToday(tz));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet open title={kind === 'income' ? 'Add income' : 'Add expense'} onClose={onClose}>
      <label className="flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Name</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === 'income' ? "Wife's paycheck" : 'Mortgage'}
          className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
        />
      </label>
      <label className="mt-3 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Amount</span>
        <MoneyField label="Amount" cents={amountCents} onCommit={setAmountCents} />
      </label>
      <label className="mt-3 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Repeats</span>
        <select
          aria-label="Repeats"
          className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as (typeof CADENCES)[number]['value'])}
        >
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">
          {kind === 'income' ? 'Next pay date' : 'Next due date'}
        </span>
        <input
          type="date"
          aria-label={kind === 'income' ? 'Next pay date' : 'Next due date'}
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
          className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
        />
      </label>
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={saving || !label.trim() || amountCents <= 0}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api('POST', '/cash-to-payday/manual-events', {
              label: label.trim(),
              kind,
              amountCents,
              cadence,
              anchorDate,
            });
            await onSaved();
            onClose();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not save.');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Sheet>
  );
}

/** Surplus: how much of today's checking balance is free to move (SPEC: no autopay). */
export function CashToPayday() {
  const { data, isPending } = useCashToPayday();
  const manualEvents = useManualCashEvents();
  const me = useMe();
  const qc = useQueryClient();
  const [pickingAccounts, setPickingAccounts] = useState(false);
  const [addingKind, setAddingKind] = useState<'income' | 'expense' | null>(null);
  const patch = useMutation({
    mutationFn: (cushionCents: number) => api('PATCH', '/me/settings', { cushionCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] });
  const removeEvent = useMutation({
    mutationFn: (id: string) => api('DELETE', `/cash-to-payday/manual-events/${id}`),
    onSuccess: refresh,
  });
  const dismissed = data?.dismissedPayMerchants ?? [];
  const setDismissed = useMutation({
    mutationFn: (next: { merchant: string; displayName: string }[]) =>
      api('PATCH', '/me/settings', { dismissedPayMerchants: next }),
    onSuccess: refresh,
  });
  // Only the Dashboard links here (routes/table.ts).
  const back = { label: 'Dashboard', to: '/' };

  if (isPending || !data) {
    return (
      <DetailPage
        header={{ back, title: 'Surplus' }}
        identity={{ label: 'Free to move right now', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }

  // C4: with no pay schedule detected yet, the projection has nothing real to anchor on —
  // showing a number here would look precise while being a guess built on nothing.
  const noPaySchedule = data.paySchedules.length === 0;

  // Each point after "Today" corresponds to exactly one projected event, in date order —
  // the running-balance delta between it and the point before it is that event's own amount.
  const upcoming = data.points.slice(1).map((p, i) => ({
    date: p.date,
    label: p.label,
    deltaCents: p.balanceCents - (data.points[i]?.balanceCents ?? p.balanceCents),
  }));
  const upcomingIncome = upcoming.filter((e) => e.deltaCents > 0);
  const upcomingExpenses = upcoming.filter((e) => e.deltaCents < 0);

  return (
    <>
      <DetailPage
        header={{ back, title: 'Surplus' }}
        identity={{
          label: 'Free to move right now',
          hero: noPaySchedule ? (
            <span className="text-2xl font-semibold text-ink-muted">Confirm your pay dates</span>
          ) : (
            <MoneyText cents={data.freeToMoveCents} whole />
          ),
          context: noPaySchedule ? (
            'No pay schedule found yet — add your income below, or wait for Rise to see a paycheck post.'
          ) : data.lowestPoint.date !== data.points[0]?.date ? (
            <>
              Lowest point is{' '}
              <strong className="text-ink">{shortDate(data.lowestPoint.date)}</strong>, after{' '}
              {data.lowestPoint.label}.
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
        related={[
          {
            title: 'Upcoming income',
            children: (
              <>
                <div className="flex items-center justify-between border-b border-hairline pb-3">
                  <h3 className="type-title">Income</h3>
                  <button
                    type="button"
                    className="text-sage-700"
                    onClick={() => setAddingKind('income')}
                  >
                    Add
                  </button>
                </div>
                {upcomingIncome.length === 0 ? (
                  <p className="py-3 text-ink-muted">Nothing expected yet.</p>
                ) : (
                  upcomingIncome.map((e, i) => (
                    <div
                      key={i}
                      className="flex justify-between gap-4 border-b border-hairline py-3"
                    >
                      <span>
                        {e.label}
                        <span className="ml-2 type-caption text-ink-faint">
                          {shortDate(e.date)}
                        </span>
                      </span>
                      <MoneyText cents={e.deltaCents} tone="in" />
                    </div>
                  ))
                )}

                {manualEvents.data &&
                  manualEvents.data.filter((m) => m.kind === 'income').length > 0 && (
                    <>
                      <h3 className="mt-6 type-title border-b border-hairline pb-3">Hand-added</h3>
                      {manualEvents.data
                        .filter((m) => m.kind === 'income')
                        .map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-4 border-b border-hairline py-3"
                          >
                            <span>
                              {m.label}
                              <span className="ml-2 type-caption text-ink-faint">
                                {CADENCE_LABEL[m.cadence] ?? m.cadence} · next{' '}
                                {shortDate(m.nextExpectedDate)}
                              </span>
                            </span>
                            <div className="flex items-center gap-3">
                              <MoneyText cents={m.amountCents} tone="in" />
                              <button
                                type="button"
                                className="type-caption text-ink-faint"
                                onClick={() => removeEvent.mutate(m.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                    </>
                  )}

                {data.paySchedules.some((s) => !s.isManual) && (
                  <>
                    <h3 className="mt-6 type-title border-b border-hairline pb-3">
                      Pay schedules detected ({data.paySchedules.filter((s) => !s.isManual).length})
                    </h3>
                    {data.paySchedules
                      .filter((s) => !s.isManual)
                      .map((s) => (
                        <div key={s.merchant} className="border-b border-hairline py-3">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-medium">{s.displayName}</span>
                            <div className="flex items-center gap-3">
                              <MoneyText cents={-s.series.expectedAmountCents} tone="in" />
                              <button
                                type="button"
                                className="type-caption text-ink-faint"
                                onClick={() =>
                                  setDismissed.mutate([
                                    ...dismissed,
                                    { merchant: s.merchant, displayName: s.displayName },
                                  ])
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <p className="mt-0.5 type-caption text-ink-faint">
                            {CADENCE_LABEL[s.series.cadence] ?? s.series.cadence} · next{' '}
                            {shortDate(s.series.nextExpectedDate)}
                          </p>
                        </div>
                      ))}
                  </>
                )}

                {dismissed.length > 0 && (
                  <>
                    <h3 className="mt-6 type-title border-b border-hairline pb-3">
                      No longer counted
                    </h3>
                    {dismissed.map((d) => (
                      <div
                        key={d.merchant}
                        className="flex items-center justify-between gap-4 border-b border-hairline py-3"
                      >
                        <span className="text-ink-muted">{d.displayName}</span>
                        <button
                          type="button"
                          className="type-caption text-sage-700"
                          onClick={() =>
                            setDismissed.mutate(dismissed.filter((x) => x.merchant !== d.merchant))
                          }
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </>
            ),
          },
          {
            title: 'Upcoming expenses',
            children: (
              <>
                <div className="flex items-center justify-between border-b border-hairline pb-3">
                  <h3 className="type-title">Expenses</h3>
                  <button
                    type="button"
                    className="text-sage-700"
                    onClick={() => setAddingKind('expense')}
                  >
                    Add
                  </button>
                </div>
                {upcomingExpenses.length === 0 ? (
                  <p className="py-3 text-ink-muted">Nothing expected yet.</p>
                ) : (
                  upcomingExpenses.map((e, i) => (
                    <div
                      key={i}
                      className="flex justify-between gap-4 border-b border-hairline py-3"
                    >
                      <span>
                        {e.label}
                        <span className="ml-2 type-caption text-ink-faint">
                          {shortDate(e.date)}
                        </span>
                      </span>
                      <MoneyText cents={e.deltaCents} />
                    </div>
                  ))
                )}

                {manualEvents.data &&
                  manualEvents.data.filter((m) => m.kind === 'expense').length > 0 && (
                    <>
                      <h3 className="mt-6 type-title border-b border-hairline pb-3">Hand-added</h3>
                      {manualEvents.data
                        .filter((m) => m.kind === 'expense')
                        .map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-4 border-b border-hairline py-3"
                          >
                            <span>
                              {m.label}
                              <span className="ml-2 type-caption text-ink-faint">
                                {CADENCE_LABEL[m.cadence] ?? m.cadence} · next{' '}
                                {shortDate(m.nextExpectedDate)}
                              </span>
                            </span>
                            <div className="flex items-center gap-3">
                              <MoneyText cents={-m.amountCents} />
                              <button
                                type="button"
                                className="type-caption text-ink-faint"
                                onClick={() => removeEvent.mutate(m.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                    </>
                  )}
              </>
            ),
          },
        ]}
      />
      {addingKind && (
        <AddManualEventSheet
          kind={addingKind}
          onClose={() => setAddingKind(null)}
          onSaved={async () => {
            await Promise.all([
              refresh(),
              qc.invalidateQueries({ queryKey: ['cash-to-payday', 'manual-events'] }),
            ]);
          }}
        />
      )}
    </>
  );
}
