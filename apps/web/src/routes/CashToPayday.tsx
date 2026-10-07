import { Loading } from '../components/Pending';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { axisPicks, surplusTone } from '../lib/surplus';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { Chevron, EditRow } from '../components/primitives/Rows';
import { Leaving, Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { ApiError, api } from '../lib/api';
import { localToday, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useAccounts, useCashToPayday, useMe } from '../lib/queries';
import { describeSchedule, draftFrom, schedulePayload, type ScheduleDraft } from '../lib/schedule';
import type { ScheduleRow, SuggestionRow } from '../lib/types';
import { ScheduleFields } from '../components/ScheduleFields';

/**
 * Balance by day to payday, the lowest point marked. Bars rise above a zero line when the
 * balance is positive and hang below it when it isn't. A single day has no shape to show.
 */
function Shape({
  points,
  lowestDate,
}: {
  points: { date: string; balanceCents: number }[];
  lowestDate: string;
}) {
  if (points.length < 2) return null;
  const hi = Math.max(...points.map((p) => p.balanceCents), 0);
  const lo = Math.min(...points.map((p) => p.balanceCents), 0);
  const span = Math.max(hi - lo, 1);
  const zeroPct = (hi / span) * 100;
  const picks = new Set(axisPicks(points.length));
  return (
    <figure className="m-0 overflow-hidden">
      <div className="relative h-28">
        <div
          aria-hidden
          className="absolute inset-x-0 border-t border-hairline"
          style={{ top: `${zeroPct}%` }}
        />
        <div className="absolute inset-0 flex gap-1.5">
          {points.map((p, i) => {
            const h = Math.max(2, (Math.abs(p.balanceCents) / span) * 100);
            const up = p.balanceCents >= 0;
            return (
              <div key={i} className="relative min-w-0 flex-1">
                <div
                  className={`absolute inset-x-0 ${up ? 'rounded-t-sm' : 'rounded-b-sm'} ${
                    p.balanceCents < 0
                      ? 'bg-clay'
                      : p.date === lowestDate
                        ? 'bg-gold'
                        : 'bg-sage-600'
                  }`}
                  style={
                    up
                      ? { bottom: `${100 - zeroPct}%`, height: `${h}%` }
                      : { top: `${zeroPct}%`, height: `${h}%` }
                  }
                >
                  <span className="sr-only">
                    {shortDate(p.date)}: {formatCents(p.balanceCents)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden className="mt-1 flex gap-1.5">
        {points.map((p, i) => (
          <span key={i} className="min-w-0 flex-1 text-center type-caption text-ink-faint">
            {picks.has(i) && <span className="block truncate">{shortDate(p.date)}</span>}
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
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    draftFrom(kind === 'income' ? 'semimonthly' : 'monthly', null, localToday(tz)),
  );
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
        <MoneyField label="Amount" cents={amountCents} draft onCommit={setAmountCents} />
      </label>
      <ScheduleFields
        draft={draft}
        onChange={setDraft}
        dateLabel={kind === 'income' ? 'Next pay date' : 'Next due date'}
      />
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
              ...schedulePayload(draft),
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

/** The paycheck/bill schedules of one kind; tap one to change its amount, days, or name. */
function ScheduleList({
  kind,
  rows,
  onEdit,
}: {
  kind: 'income' | 'expense';
  rows: ScheduleRow[];
  onEdit: (r: ScheduleRow) => void;
}) {
  const mine = rows
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  if (mine.length === 0) return null;
  return (
    <>
      <h3 className="mt-6 type-title border-b border-hairline pb-3">Schedules</h3>
      {mine.map((r) => (
        <button
          key={r.id ?? r.merchant}
          type="button"
          onClick={() => onEdit(r)}
          className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-hairline py-3 text-left active:bg-sage-100"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.displayName}</span>
            <span className="block type-caption text-ink-faint">
              {describeSchedule(r.cadence, r.anchorDays)} · next {shortDate(r.nextExpectedDate)}
            </span>
            {r.change && (
              <span className="block type-caption text-ink-faint">
                <MoneyText cents={r.change.amountCents} /> from {shortDate(r.change.on)}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <MoneyText cents={r.amountCents} tone={kind === 'income' ? 'in' : 'ink'} />
            <Chevron />
          </span>
        </button>
      ))}
    </>
  );
}

/** The last row of a list: a full-width tap target that adds to it. */
function AddRow({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center py-3 text-left font-medium text-sage-700 active:bg-sage-100"
    >
      {children}
    </button>
  );
}

/** What sync found in the cash accounts. Nothing here counts until it is added. */
function SuggestionList({
  rows,
  onAdd,
  onDismiss,
}: {
  rows: SuggestionRow[];
  onAdd: (r: SuggestionRow) => void;
  onDismiss: (r: SuggestionRow) => void;
}) {
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.merchant} className="border-b border-hairline py-3">
          <div className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.displayName}</span>
              <span className="block type-caption text-ink-faint">
                {r.accountName} · {describeSchedule(r.cadence, r.anchorDays)} · next{' '}
                {shortDate(r.nextExpectedDate)}
              </span>
              {r.likelySameAs && (
                <span className="block type-caption text-gold-text">
                  Looks like {r.likelySameAs}, already in Surplus
                </span>
              )}
            </span>
            <MoneyText cents={r.amountCents} tone={r.kind === 'income' ? 'in' : 'ink'} />
          </div>
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={() => onAdd(r)}>
              Add
            </Button>
            <Button variant="quiet" className="flex-1" onClick={() => onDismiss(r)}>
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Edit one schedule, or review a suggestion before adding it. "Remove" deletes a schedule;
 * a suggestion is dismissed instead.
 */
function EditScheduleSheet({
  row,
  onClose,
  onSaved,
  onDismiss,
}: {
  row: ScheduleRow;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onDismiss: () => void;
}) {
  const [label, setLabel] = useState(row.displayName);
  const [amountCents, setAmountCents] = useState(row.amountCents);
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    draftFrom(row.cadence, row.anchorDays, row.nextExpectedDate),
  );
  const [changing, setChanging] = useState(row.change != null);
  const [changeCents, setChangeCents] = useState(row.change?.amountCents ?? row.amountCents);
  const [changeOn, setChangeOn] = useState(row.change?.on ?? row.nextExpectedDate);
  const changeInvalid = changing && (changeCents <= 0 || !changeOn);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open title={row.displayName} onClose={onClose}>
      {row.isHandAdded && (
        <label className="flex flex-col gap-1">
          <span className="type-caption text-ink-muted">Name</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
          />
        </label>
      )}
      <label className="mt-3 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Amount</span>
        <MoneyField label="Amount" cents={amountCents} draft onCommit={setAmountCents} />
      </label>
      {row.id && (
        <div className="mt-3 flex min-h-11 items-center justify-between gap-4">
          <span>Amount changes</span>
          <Toggle label="Amount changes" on={changing} onChange={setChanging} />
        </div>
      )}
      {row.id && changing && (
        <div className="mt-1 flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-caption text-ink-muted">Starting</span>
            <input
              type="date"
              aria-label="Starting"
              value={changeOn}
              onChange={(e) => setChangeOn(e.target.value)}
              className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-caption text-ink-muted">New amount</span>
            <MoneyField label="New amount" cents={changeCents} draft onCommit={setChangeCents} />
          </label>
        </div>
      )}
      <ScheduleFields
        draft={draft}
        onChange={setDraft}
        dateLabel={row.kind === 'income' ? 'Next pay date' : 'Next due date'}
      />
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={saving || amountCents <= 0 || changeInvalid || (row.isHandAdded && !label.trim())}
        onClick={() =>
          void run(() =>
            api('PUT', '/cash-to-payday/schedules', {
              ...(row.id ? { id: row.id } : { merchant: row.merchant }),
              kind: row.kind,
              amountCents,
              ...schedulePayload(draft),
              ...(row.isHandAdded ? { label: label.trim() } : {}),
              ...(row.id
                ? { change: changing ? { amountCents: changeCents, on: changeOn } : null }
                : {}),
            }),
          )
        }
      >
        {saving ? 'Saving…' : row.id ? 'Save' : 'Add to Surplus'}
      </Button>
      <Button
        variant="quiet"
        className="mt-2 w-full"
        disabled={saving}
        onClick={() =>
          row.id
            ? void run(() =>
                api('DELETE', `/cash-to-payday/schedules/${encodeURIComponent(row.id as string)}`),
              )
            : onDismiss()
        }
      >
        {row.id ? 'Remove' : 'Dismiss'}
      </Button>
    </Sheet>
  );
}

/** Surplus: how much of today's checking balance is free to move (SPEC: no autopay). */
export function CashToPayday() {
  const { data, isPending } = useCashToPayday();
  const me = useMe();
  const qc = useQueryClient();
  const [pickingAccounts, setPickingAccounts] = useState(false);
  const [addingKind, setAddingKind] = useState<'income' | 'expense' | null>(null);
  const patch = useMutation({
    mutationFn: (cushionCents: number) => api('PATCH', '/me/settings', { cushionCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash-to-payday'] });
  const dismissed = data?.dismissedPayMerchants ?? [];
  const setDismissed = useMutation({
    mutationFn: (next: { merchant: string; displayName: string }[]) =>
      api('PATCH', '/me/settings', { dismissedPayMerchants: next }),
    onSuccess: refresh,
  });
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const schedules = data?.schedules ?? [];
  const suggestions = data?.suggestions ?? [];
  const dismiss = (r: { merchant: string; displayName: string }) =>
    setDismissed.mutate([...dismissed, { merchant: r.merchant, displayName: r.displayName }]);
  // The Dashboard's "to review in Surplus" row lands here.
  const { hash } = useLocation();
  const reviewRef = useRef<HTMLDivElement>(null);
  const hasSuggestions = suggestions.length > 0;
  useEffect(() => {
    if (hash === '#review' && hasSuggestions) reviewRef.current?.scrollIntoView();
  }, [hash, hasSuggestions]);
  // Only the Dashboard links here (routes/table.ts).
  const back = { label: 'Dashboard', to: '/' };

  if (isPending || !data) {
    return (
      <DetailPage
        header={{ back, title: 'Surplus' }}
        identity={{
          label: 'On hand until payday',
          hero: (
            <Loading compact>
              <Skeleton className="h-11 w-40" />
            </Loading>
          ),
        }}
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
          label: 'On hand until payday',
          hero: noPaySchedule ? (
            <span className="text-2xl font-semibold text-ink-muted">Confirm your pay dates</span>
          ) : (
            <MoneyText
              cents={data.freeToMoveCents}
              tone={surplusTone(data.freeToMoveCents)}
              whole
            />
          ),
          context: noPaySchedule ? (
            'Add your income below.'
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
          ...(hasSuggestions
            ? [
                {
                  title: 'To review',
                  children: (
                    <div ref={reviewRef} className="scroll-mt-16">
                      <SuggestionList
                        rows={suggestions}
                        onAdd={(r) => setEditing({ ...r, id: null, isHandAdded: false })}
                        onDismiss={dismiss}
                      />
                    </div>
                  ),
                },
              ]
            : []),
          {
            title: 'Upcoming income',
            children: (
              <>
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

                <ScheduleList kind="income" rows={schedules} onEdit={setEditing} />
                <AddRow onClick={() => setAddingKind('income')}>Add income</AddRow>
              </>
            ),
          },
          {
            title: 'Upcoming expenses',
            children: (
              <>
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

                <ScheduleList kind="expense" rows={schedules} onEdit={setEditing} />
                <AddRow onClick={() => setAddingKind('expense')}>Add expense</AddRow>
              </>
            ),
          },
        ]}
      />
      <Leaving>
        {editing && (
          <EditScheduleSheet
            row={editing}
            onClose={() => setEditing(null)}
            onSaved={refresh}
            onDismiss={() => {
              dismiss(editing);
              setEditing(null);
            }}
          />
        )}
      </Leaving>
      <Leaving>
        {addingKind && (
          <AddManualEventSheet
            kind={addingKind}
            onClose={() => setAddingKind(null)}
            onSaved={async () => {
              await refresh();
            }}
          />
        )}
      </Leaving>
    </>
  );
}
