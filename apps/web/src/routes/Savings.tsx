import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SavingsGoal, SavingsPlan } from '@rise/shared/schemas';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { api } from '../lib/api';
import { monthName, periodOf } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useAccounts, useMe, useToday } from '../lib/queries';
import { goalView, newGoalId, type GoalView } from '../lib/savings';

const numberBox = (
  label: string,
  value: string,
  set: (v: string) => void,
  width = 'w-12',
  suffix?: string,
) => (
  <span className="inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600">
    <input
      aria-label={label}
      inputMode="numeric"
      value={value}
      onChange={(e) => set(e.target.value)}
      className={`money ${width} bg-transparent text-right outline-none`}
    />
    {suffix && <span className="ml-1 text-ink-muted">{suffix}</span>}
  </span>
);

/** Add or edit a goal. Nothing is saved until Save. */
function GoalSheet({
  open,
  onClose,
  goal,
  accounts,
  onSave,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  goal: SavingsGoal | null;
  accounts: { id: string; name: string; balanceCents: number }[];
  onSave: (g: SavingsGoal) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [emergency, setEmergency] = useState(goal?.kind === 'emergency');
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? null);
  const [target, setTarget] = useState(goal?.targetCents ?? 0);
  const [monthly, setMonthly] = useState(goal?.monthlyCents ?? 0);
  const [months, setMonths] = useState(String(goal?.months ?? 6));
  const [expense, setExpense] = useState(goal?.monthlyExpenseCents ?? 0);
  const [whole, setWhole] = useState(goal ? goal.savedCents === null : true);
  const [share, setShare] = useState(goal?.savedCents ?? 0);
  const m = Number(months);
  const valid =
    name.trim() !== '' && accountId !== null && Number.isInteger(m) && m >= 1 && m <= 36;
  return (
    <Sheet
      open={open}
      title={goal ? goal.name : 'Add a goal'}
      onClose={onClose}
      action={{
        label: 'Save',
        disabled: !valid,
        onClick: () => {
          if (!valid || accountId === null) return;
          onSave({
            id: goal?.id ?? newGoalId(),
            name: name.trim(),
            accountId,
            kind: emergency ? 'emergency' : 'goal',
            targetCents: target,
            monthlyCents: monthly,
            months: m,
            monthlyExpenseCents: expense,
            savedCents: whole ? null : share,
          });
          onClose();
        },
      }}
    >
      <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              role="radio"
              aria-checked={accountId === a.id}
              onClick={() => setAccountId(a.id)}
              className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="flex items-center gap-3">
                <MoneyText cents={a.balanceCents} tone="muted" />
                <span
                  aria-hidden
                  className={`size-5 rounded-full border ${
                    accountId === a.id ? 'border-sage-600 bg-sage-600' : 'border-hairline'
                  }`}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Name"
          field={
            <input
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-11 w-44 rounded-input border border-hairline bg-surface px-3 text-right outline-none focus:border-sage-600"
            />
          }
        />
        <EditRow
          label="Emergency fund"
          field={<Toggle label="Emergency fund" on={emergency} onChange={setEmergency} />}
        />
        {emergency ? (
          <>
            <EditRow
              label="Months to cover"
              field={numberBox('Months to cover', months, setMonths)}
            />
            <EditRow
              label="Monthly expenses"
              field={<MoneyField label="Monthly expenses" cents={expense} onCommit={setExpense} />}
            />
          </>
        ) : (
          <EditRow
            label="Target"
            field={<MoneyField label="Target" cents={target} onCommit={setTarget} />}
          />
        )}
        <EditRow
          label="Per month"
          field={<MoneyField label="Per month" cents={monthly} onCommit={setMonthly} />}
        />
        <EditRow
          label="Whole account"
          field={<Toggle label="Whole account" on={whole} onChange={setWhole} />}
        />
        {!whole && (
          <EditRow
            label="Counts toward goal"
            field={<MoneyField label="Counts toward goal" cents={share} onCommit={setShare} />}
          />
        )}
      </div>
      {goal && (
        <div className="mt-4">
          <Button
            variant="danger"
            onClick={() => {
              onRemove(goal.id);
              onClose();
            }}
          >
            Remove goal
          </Button>
        </div>
      )}
    </Sheet>
  );
}

const paceText = (v: GoalView): string =>
  v.monthsToGo === 0 ? 'Reached' : v.period === null ? 'Set a monthly amount' : monthName(v.period);

export function Savings() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [open, setOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);

  const save = useMutation({
    mutationFn: (savings: SavingsPlan) => api('PATCH', '/me/settings', { savings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const header = {
    back: { label: 'Financial health', to: '/financial-health' },
    title: 'Savings goals',
  };
  if (!me || !accounts) {
    return <DetailPage header={header} shape={<Skeleton className="h-64 w-full" />} />;
  }

  const live = accounts.filter((a) => !a.archivedAt);
  const cash = live.filter((a) => a.kind === 'depository');
  const goals = me.settings.savings?.goals ?? [];
  const views = goals.map((g) => goalView(g, live, periodOf(today)));
  const edit = (next: SavingsGoal[]) => save.mutate({ goals: next });
  const openSheet = (g: SavingsGoal | null) => {
    setEditing(g);
    setSheetKey((k) => k + 1);
    setOpen(true);
  };
  const sheet = (
    <GoalSheet
      key={sheetKey}
      open={open}
      onClose={() => setOpen(false)}
      goal={editing}
      accounts={cash}
      onSave={(g) => edit([...goals.filter((x) => x.id !== g.id), g])}
      onRemove={(id) => edit(goals.filter((g) => g.id !== id))}
    />
  );

  if (views.length === 0) {
    return (
      <>
        <DetailPage
          header={header}
          identity={{
            label: 'Savings goals',
            hero: <span className="text-ink-muted">Not set up</span>,
          }}
          manage={
            <div className="py-3">
              <Button onClick={() => openSheet(null)}>Add a goal</Button>
            </div>
          }
        />
        {sheet}
      </>
    );
  }

  const fund = views.find((v) => v.goal.kind === 'emergency');
  const row = (v: GoalView) => (
    <button
      key={v.goal.id}
      type="button"
      onClick={() => openSheet(v.goal)}
      className="block min-h-14 w-full border-b border-hairline py-3 text-left last:border-b-0 active:bg-sage-100"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">{v.goal.name}</span>
        <span className="shrink-0 money">{paceText(v)}</span>
      </span>
      <span className="mt-1 block type-caption text-ink-muted money">
        {formatCents(v.savedCents, { whole: true })} of{' '}
        {formatCents(v.targetCents, { whole: true })} · {v.pct}% · {v.accountName}
      </span>
      <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-canvas">
        <span className="block h-full rounded-full bg-sage-600" style={{ width: `${v.pct}%` }} />
      </span>
    </button>
  );

  return (
    <>
      <DetailPage
        header={header}
        identity={
          fund && fund.covered !== null
            ? {
                label: `${fund.goal.name} covers`,
                hero: <span className="money">{fund.covered} months</span>,
                context: (
                  <span className="money">
                    {formatCents(fund.savedCents, { whole: true })} of{' '}
                    {formatCents(fund.targetCents, { whole: true })}
                  </span>
                ),
              }
            : {
                label: 'Saved toward goals',
                hero: (
                  <span className="money">
                    {formatCents(
                      views.reduce((n, v) => n + v.savedCents, 0),
                      { whole: true },
                    )}
                  </span>
                ),
              }
        }
        related={[{ title: 'Goals', children: <div>{views.map(row)}</div> }]}
        manage={
          <div className="py-3">
            <Button variant="quiet" onClick={() => openSheet(null)}>
              Add a goal
            </Button>
          </div>
        }
      />
      {sheet}
    </>
  );
}
