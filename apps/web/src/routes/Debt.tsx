import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Chart } from '../components/primitives/Chart';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow, ValueRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { ApiError, api } from '../lib/api';
import {
  DEFAULT_DEBT_PLAN,
  aprFromText,
  aprToText,
  dueSuggestions,
  groupView,
  owedCents,
  planLoans,
  type GroupView,
} from '../lib/debt';
import { addMonths, monthName, periodOf } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useAccounts, useInvalidateMoney, useMe, useToday } from '../lib/queries';

/** A short radio row, like the Investments range chips. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-canvas p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`min-h-9 rounded-full px-3 type-caption font-medium ${
            o.id === value ? 'bg-surface text-sage-700 shadow-soft' : 'text-ink-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const GROUPS = [
  { id: 'student', label: 'Student loans' },
  { id: 'mortgage', label: 'Mortgage' },
] as const;

/** Add a loan to the plan, or edit one. Nothing is saved until Save. */
function LoanSheet({
  open,
  onClose,
  loan,
  accountName,
  candidates,
  today,
  onSave,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  /** The loan being edited; null when adding. */
  loan: DebtLoanPlan | null;
  accountName: string | null;
  candidates: { id: string; name: string; owedCents: number }[];
  today: string;
  onSave: (l: DebtLoanPlan) => void;
  onRemove: (accountId: string) => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(loan?.accountId ?? null);
  const [group, setGroup] = useState<DebtLoanPlan['group']>(loan?.group ?? 'student');
  const [apr, setApr] = useState(loan ? aprToText(loan.aprMilliPct) : '');
  const [payment, setPayment] = useState(loan?.paymentCents ?? 0);
  const [dueDay, setDueDay] = useState(String(loan?.dueDay ?? 1));
  const aprMilli = aprFromText(apr);
  const due = Number(dueDay);
  const valid =
    accountId !== null && aprMilli !== null && Number.isInteger(due) && due >= 1 && due <= 31;
  return (
    <Sheet
      open={open}
      title={loan ? (accountName ?? 'Loan') : 'Add a loan'}
      onClose={onClose}
      action={{
        label: 'Save',
        disabled: !valid,
        onClick: () => {
          if (!valid || accountId === null || aprMilli === null) return;
          onSave({
            accountId,
            group,
            aprMilliPct: aprMilli,
            paymentCents: payment,
            dueDay: due,
            appliedThrough: loan?.appliedThrough ?? periodOf(today),
          });
          onClose();
        },
      }}
    >
      {!loan && (
        <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
          {candidates.length === 0 && (
            <li className="px-4 py-3 text-ink-muted">Every loan account is already in the plan.</li>
          )}
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="radio"
                aria-checked={accountId === c.id}
                onClick={() => setAccountId(c.id)}
                className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
              >
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="flex items-center gap-3">
                  <MoneyText cents={c.owedCents} tone="muted" />
                  <span
                    aria-hidden
                    className={`size-5 rounded-full border ${
                      accountId === c.id ? 'border-sage-600 bg-sage-600' : 'border-hairline'
                    }`}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Counts as"
          field={
            <Segmented label="Counts as" value={group} options={[...GROUPS]} onChange={setGroup} />
          }
        />
        <EditRow
          label="Rate"
          field={
            <span className="inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600">
              <input
                aria-label="Rate"
                inputMode="decimal"
                value={apr}
                onChange={(e) => setApr(e.target.value)}
                className="money w-16 bg-transparent text-right outline-none"
              />
              <span className="ml-1 text-ink-muted">%</span>
            </span>
          }
        />
        <EditRow
          label="Monthly payment"
          field={<MoneyField label="Monthly payment" cents={payment} onCommit={setPayment} />}
        />
        <EditRow
          label="Due day"
          field={
            <span className="inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600">
              <input
                aria-label="Due day"
                inputMode="numeric"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className="money w-10 bg-transparent text-right outline-none"
              />
            </span>
          }
        />
      </div>
      {loan && (
        <div className="mt-4">
          <Button
            variant="danger"
            onClick={() => {
              onRemove(loan.accountId);
              onClose();
            }}
          >
            Remove from plan
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function HomeValueSheet({
  open,
  onClose,
  accounts,
  selectedId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; balanceCents: number }[];
  selectedId: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <Sheet open={open} title="Home value account" onClose={onClose}>
      <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {[{ id: null, name: 'None', balanceCents: null }, ...accounts].map((a) => (
          <li key={a.id ?? 'none'}>
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === a.id}
              onClick={() => {
                onPick(a.id);
                onClose();
              }}
              className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="flex items-center gap-3">
                {a.balanceCents !== null && <MoneyText cents={a.balanceCents} tone="muted" />}
                <span
                  aria-hidden
                  className={`size-5 rounded-full border ${
                    selectedId === a.id ? 'border-sage-600 bg-sage-600' : 'border-hairline'
                  }`}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const payoffText = (done: boolean, period: string | null): string =>
  done ? 'Paid off' : period === null ? 'Set payment' : monthName(period);

/** Up to ~48 evenly spaced points, always ending at the last month. */
function chartPoints(view: GroupView, period: string) {
  const owed = view.totalOwedByMonth;
  const step = Math.max(1, Math.ceil((owed.length - 1) / 48));
  const idx = Array.from({ length: Math.ceil((owed.length - 1) / step) + 1 }, (_, i) =>
    Math.min(i * step, owed.length - 1),
  );
  return idx.map((i) => ({
    cents: owed[i] ?? 0,
    inferred: false,
    label: monthName(addMonths(period, i)),
  }));
}

export function Debt() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const qc = useQueryClient();
  const invalidateMoney = useInvalidateMoney();
  // Sheets stay mounted so they slide out; a counter or the account id remounts them fresh.
  const [editing, setEditing] = useState<DebtLoanPlan | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [pickingHome, setPickingHome] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (debt: DebtPlan) => api('PATCH', '/me/settings', { debt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const plan = me?.settings.debt ?? null;
  const period = periodOf(today);
  const live = useMemo(() => (accounts ?? []).filter((a) => !a.archivedAt), [accounts]);
  const student = useMemo(
    () =>
      plan
        ? groupView(
            planLoans(plan, live, 'student'),
            { extraCents: plan.extraCents, strategy: plan.strategy, rollForward: plan.rollForward },
            period,
          )
        : null,
    [plan, live, period],
  );
  const mortgageLoans = plan ? planLoans(plan, live, 'mortgage') : [];
  const mortgage =
    plan && mortgageLoans.length > 0
      ? groupView(
          mortgageLoans,
          { extraCents: plan.mortgageExtraCents, strategy: 'snowball', rollForward: true },
          period,
        )
      : null;
  const suggestions = plan ? dueSuggestions(plan, live, today) : [];

  const header = { back: { label: 'Financial health', to: '/financial-health' }, title: 'Debt' };
  if (!me || !accounts) {
    return <DetailPage header={header} shape={<Skeleton className="h-64 w-full" />} />;
  }

  const current = plan ?? DEFAULT_DEBT_PLAN;
  const edit = (patch: Partial<DebtPlan>) => save.mutate({ ...current, ...patch });
  const upsert = (l: DebtLoanPlan) =>
    edit({ loans: [...current.loans.filter((x) => x.accountId !== l.accountId), l] });
  const inPlan = new Set(current.loans.map((l) => l.accountId));
  const candidates = live
    .filter(
      (a) => !inPlan.has(a.id) && (a.kind === 'loan' || (a.kind === 'other' && a.balanceCents < 0)),
    )
    .map((a) => ({ id: a.id, name: a.name, owedCents: owedCents(a.balanceCents) }));
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? null;
  const homeAccounts = live.filter((a) => a.balanceCents > 0 && a.kind !== 'depository');
  const homeValue = accounts.find((a) => a.id === current.homeValueAccountId);

  const openAdd = () => {
    setAddKey((k) => k + 1);
    setAdding(true);
  };
  const openEdit = (l: DebtLoanPlan) => {
    setEditing(l);
    setEditOpen(true);
  };

  const apply = async () => {
    setError(null);
    try {
      for (const s of suggestions)
        await api('POST', `/accounts/${s.plan.accountId}/snapshots`, {
          asOf: today,
          balanceCents: -s.afterCents,
        });
      await skip();
      await invalidateMoney();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the balances.');
    }
  };
  const lastAuto =
    current.lastAuto && current.lastAuto.period >= addMonths(period, -1) ? current.lastAuto : null;
  const undoAuto = async () => {
    if (!lastAuto) return;
    setError(null);
    try {
      for (const l of lastAuto.loans)
        await api('POST', `/accounts/${l.accountId}/snapshots`, {
          asOf: l.asOf,
          balanceCents: -l.beforeCents,
        });
      // The month stays marked done, so the next sync doesn't apply it again.
      await api('PATCH', '/me/settings', { debt: { ...current, lastAuto: null } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await invalidateMoney();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not undo.');
    }
  };
  const skip = async () => {
    const due = new Set(suggestions.map((s) => s.plan.accountId));
    await api('PATCH', '/me/settings', {
      debt: {
        ...current,
        loans: current.loans.map((l) =>
          due.has(l.accountId) ? { ...l, appliedThrough: period } : l,
        ),
      },
    });
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  const sheets = (
    <>
      <LoanSheet
        key={`add${addKey}`}
        open={adding}
        onClose={() => setAdding(false)}
        loan={null}
        accountName={null}
        candidates={candidates}
        today={today}
        onSave={upsert}
        onRemove={() => {}}
      />
      <LoanSheet
        key={editing?.accountId ?? 'edit'}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        loan={editing}
        accountName={editing ? nameOf(editing.accountId) : null}
        candidates={[]}
        today={today}
        onSave={upsert}
        onRemove={(id) => edit({ loans: current.loans.filter((l) => l.accountId !== id) })}
      />
      <HomeValueSheet
        open={pickingHome}
        onClose={() => setPickingHome(false)}
        accounts={homeAccounts}
        selectedId={current.homeValueAccountId}
        onPick={(id) => edit({ homeValueAccountId: id })}
      />
    </>
  );

  if (!plan || plan.loans.length === 0 || !student) {
    return (
      <>
        <DetailPage
          header={header}
          identity={{ label: 'Debt', hero: <span className="text-ink-muted">Not set up</span> }}
          manage={
            <div className="py-3">
              <Button onClick={openAdd}>Add a loan</Button>
            </div>
          }
        />
        {sheets}
      </>
    );
  }

  const loanRow = (r: GroupView['rows'][number]) => (
    <button
      key={r.plan.accountId}
      type="button"
      onClick={() => openEdit(r.plan)}
      className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-hairline py-3 text-left last:border-b-0 active:bg-sage-100"
    >
      <span className="min-w-0">
        <span className={`block truncate ${r.done ? 'text-ink-faint' : ''}`}>{r.name}</span>
        <span className="block type-caption text-ink-muted money">
          {r.done ? '' : <MoneyText cents={r.owedCents} tone="muted" whole />}
          {r.done ? '' : ' · '}
          {aprToText(r.plan.aprMilliPct)}% · {formatCents(r.plan.paymentCents)}/mo
        </span>
      </span>
      <span className={`shrink-0 money ${r.done ? 'text-ink-faint' : ''}`}>
        {payoffText(r.done, r.payoffPeriod)}
      </span>
    </button>
  );
  const savings = (v: GroupView) =>
    v.monthsSooner !== null && v.interestSavedCents !== null ? (
      <>
        <StaticRow
          label="Sooner by"
          value={`${v.monthsSooner} ${v.monthsSooner === 1 ? 'month' : 'months'}`}
        />
        <StaticRow
          label="Interest saved"
          value={<MoneyText cents={v.interestSavedCents} whole />}
        />
      </>
    ) : null;

  const hasStudent = student.rows.length > 0;
  const equity = homeValue && mortgage ? homeValue.balanceCents - mortgage.owedCents : null;
  const mortgageRow = mortgage?.rows[0];

  return (
    <>
      <DetailPage
        header={header}
        identity={
          hasStudent
            ? {
                label: 'Student loans debt-free',
                hero: student.debtFreePeriod ? (
                  <span className="money">{monthName(student.debtFreePeriod)}</span>
                ) : (
                  <span className="text-ink-muted">—</span>
                ),
                context: (
                  <span className="money">
                    {formatCents(student.owedCents, { whole: true })} owed
                    {student.debtFreePeriod
                      ? ` · ${formatCents(student.interestCents, { whole: true })} interest`
                      : ''}
                  </span>
                ),
              }
            : { label: 'Debt', hero: <span className="text-ink-muted">No student loans</span> }
        }
        shape={
          <>
            {lastAuto && (
              <div className="mb-4 rounded-card bg-surface p-4 shadow-soft">
                <p className="type-label font-semibold text-ink-muted">
                  {monthName(lastAuto.period, false)} payments applied
                </p>
                <ul className="mt-2">
                  {lastAuto.loans.map((l) => (
                    <li
                      key={l.accountId}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate">{nameOf(l.accountId)}</span>
                      <span className="shrink-0 money text-ink-muted">
                        {formatCents(l.beforeCents, { whole: true })} →{' '}
                        <span className="text-ink">
                          {formatCents(l.afterCents, { whole: true })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {!suggestions.length && error && <p className="mt-2 text-clay">{error}</p>}
                <div className="mt-3">
                  <Button variant="quiet" onClick={() => void undoAuto()}>
                    Undo
                  </Button>
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="mb-4 rounded-card bg-surface p-4 shadow-soft">
                <p className="type-label font-semibold text-ink-muted">
                  {monthName(period, false)} payments
                </p>
                <ul className="mt-2">
                  {suggestions.map((s) => (
                    <li
                      key={s.plan.accountId}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="shrink-0 money text-ink-muted">
                        {formatCents(s.beforeCents, { whole: true })} →{' '}
                        <span className="text-ink">
                          {formatCents(s.afterCents, { whole: true })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {error && <p className="mt-2 text-clay">{error}</p>}
                <div className="mt-3 flex gap-2">
                  <Button onClick={apply}>Apply</Button>
                  <Button variant="quiet" onClick={() => void skip()}>
                    Skip
                  </Button>
                </div>
              </div>
            )}
            {hasStudent && student.debtFreePeriod && student.totalOwedByMonth.length > 2 && (
              <Chart
                kind="line"
                label="Student loans still owed"
                points={chartPoints(student, period)}
              />
            )}
          </>
        }
        facts={
          hasStudent ? (
            <>
              <EditRow
                label="Extra per month"
                field={
                  <MoneyField
                    label="Extra per month"
                    cents={current.extraCents}
                    onCommit={(c) => edit({ extraCents: c })}
                  />
                }
              />
              <EditRow
                label="Extra goes to"
                field={
                  <Segmented
                    label="Extra goes to"
                    value={current.strategy}
                    options={[
                      { id: 'snowball', label: 'Smallest' },
                      { id: 'avalanche', label: 'Highest rate' },
                    ]}
                    onChange={(strategy) => edit({ strategy })}
                  />
                }
              />
              <EditRow
                label="Apply payments when they post"
                field={
                  <Toggle
                    label="Apply payments when they post"
                    on={current.autoApply}
                    onChange={(autoApply) => edit({ autoApply })}
                  />
                }
              />
              <EditRow
                label="Freed payments move on"
                field={
                  <Toggle
                    label="Freed payments move on"
                    on={current.rollForward}
                    onChange={(rollForward) => edit({ rollForward })}
                  />
                }
              />
              {savings(student)}
            </>
          ) : undefined
        }
        related={[
          ...(hasStudent
            ? [{ title: 'Student loans', children: <div>{student.rows.map(loanRow)}</div> }]
            : []),
          ...(mortgage && mortgageRow
            ? [
                {
                  title: 'Mortgage',
                  children: (
                    <div>
                      <button
                        type="button"
                        onClick={() => openEdit(mortgageRow.plan)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-hairline py-3 text-left active:bg-sage-100"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{mortgageRow.name}</span>
                          <span className="block type-caption text-ink-muted money">
                            <MoneyText cents={mortgageRow.owedCents} tone="muted" />
                            {` · ${aprToText(mortgageRow.plan.aprMilliPct)}% · ${formatCents(mortgageRow.plan.paymentCents)}/mo`}
                          </span>
                        </span>
                        <span className="shrink-0 money">
                          {payoffText(mortgageRow.done, mortgageRow.payoffPeriod)}
                        </span>
                      </button>
                      <EditRow
                        label="Extra per month"
                        field={
                          <MoneyField
                            label="Mortgage extra per month"
                            cents={current.mortgageExtraCents}
                            onCommit={(c) => edit({ mortgageExtraCents: c })}
                          />
                        }
                      />
                      {savings(mortgage)}
                      <ValueRow
                        label="Home value"
                        onClick={() => setPickingHome(true)}
                        muted={!homeValue}
                      >
                        {homeValue ? (
                          <MoneyText cents={homeValue.balanceCents} whole />
                        ) : (
                          'Choose account'
                        )}
                      </ValueRow>
                      {equity !== null && (
                        <StaticRow label="Equity" value={<MoneyText cents={equity} whole />} />
                      )}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        manage={
          <div className="py-3">
            <Button variant="quiet" onClick={openAdd}>
              Add a loan
            </Button>
          </div>
        }
      />
      {sheets}
    </>
  );
}
