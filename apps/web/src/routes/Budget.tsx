import type { ViewCategory } from '@rise/shared/budget';
import type { Category, CategoryGroup, Reallocation } from '@rise/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AddCategorySheet } from '../components/AddCategorySheet';
import { usePlanFlow } from '../components/PlanFlow';
import { Icon } from '../components/primitives/Icon';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { Rail } from '../components/primitives/Rail';
import { EditRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { addMonths, monthName, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';

import {
  useCategories,
  useGroups,
  useInvalidateMoney,
  usePeriod,
  useRecurring,
  useToday,
} from '../lib/queries';
import type { PeriodResponse } from '../lib/types';

/** The Budget tab (T37): pool, groups with roll-ups, and a rail per category. */
export function Budget() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? today.slice(0, 7);
  const period = usePeriod(month);
  const groups = useGroups();
  const categories = useCategories();
  const invalidate = useInvalidateMoney();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = usePlanFlow(month, categories.data ?? []);

  if (!period.data || !groups.data || !categories.data) return <BudgetSkeleton />;
  const p = period.data;
  const closed = p.period.status === 'closed';
  const byId = new Map(categories.data.map((c) => [c.id, c]));
  const expenseGroups = groups.data.filter((g) => g.kind === 'expense');

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <MonthSwitcher
        month={month}
        today={today}
        onChange={(m) => setParams(m === today.slice(0, 7) ? {} : { m })}
      />

      <header className="gutter pt-2 pb-6">
        <div className="flex items-center justify-between">
          <p className="type-label text-ink-muted">
            {closed ? 'Returned to the pool' : 'Ready to assign'}
          </p>
          <Link
            to={`/settings/budget?from=${encodeURIComponent(`Budget|/budget${month === today.slice(0, 7) ? '' : `?m=${month}`}`)}`}
            aria-label="Budget settings"
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
          >
            <Icon name="sliders" />
          </Link>
        </div>
        <p className="mt-1 type-display">
          <MoneyText
            cents={closed ? p.period.returnedSurplusCents : p.poolCents}
            tone={!closed && p.poolCents < 0 ? 'over' : 'ink'}
          />
        </p>
        <p className="mt-1 text-ink-muted">
          <MoneyText cents={p.totals.plannedCents} tone="muted" /> planned ·{' '}
          <MoneyText cents={p.totals.spentCents} tone="muted" /> spent
        </p>
      </header>

      <CloseControl month={month} data={p} />

      <section className="gutter">
        <EditRow
          label="Expected income"
          field={
            closed ? (
              <MoneyText cents={p.expectedIncomeCents} />
            ) : (
              <MoneyField
                label="Expected income"
                cents={p.expectedIncomeCents}
                onCommit={async (v) => {
                  await api('PATCH', `/periods/${month}`, { expectedIncomeCents: v });
                  await invalidate();
                }}
              />
            )
          }
        />
        <div className="flex min-h-12 items-center justify-between border-b border-hairline py-3">
          <span className="text-ink-muted">Income so far</span>
          <MoneyText cents={p.actualIncomeCents} />
        </div>
        {!groups.data.some((g) => g.kind === 'income') && (
          <p className="py-3 type-caption text-ink-muted">
            Paychecks count once they're filed under an income category.{' '}
            <button
              className="min-h-11 font-medium text-sage-700"
              onClick={async () => {
                setError(null);
                try {
                  const g = await api<{ id: string }>('POST', '/category-groups', {
                    name: 'Income',
                    kind: 'income',
                  });
                  await api('POST', '/categories', { groupId: g.id, name: 'Paycheck' });
                  await invalidate();
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Could not add it.');
                }
              }}
            >
              Add a Paycheck category
            </button>
          </p>
        )}
      </section>

      {(error ?? plan.error) && <p className="gutter mt-4 text-clay">{error ?? plan.error}</p>}

      {expenseGroups.length === 0 ? (
        <EmptyBudget onAdd={() => setAdding(true)} />
      ) : (
        expenseGroups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            rows={p.categories.filter((c) => byId.get(c.categoryId)?.groupId === g.id)}
            byId={byId}
            month={month}
            editable={!closed}
            onEdit={(row) => {
              const category = byId.get(row.categoryId);
              if (category) plan.open(category, row, p.poolCents);
            }}
          />
        ))
      )}

      {expenseGroups.length > 0 && !closed && (
        <div className="gutter mt-6">
          <Button variant="quiet" onClick={() => setAdding(true)}>
            + Add category
          </Button>
        </div>
      )}

      <Upcoming month={month} today={today} categories={categories.data} />
      <Moves month={month} categories={categories.data} />

      {plan.sheets}
      <AddCategorySheet open={adding} groups={groups.data} onClose={() => setAdding(false)} />
    </div>
  );
}

function MonthSwitcher({
  month,
  today,
  onChange,
}: {
  month: string;
  today: string;
  onChange: (m: string) => void;
}) {
  const current = today.slice(0, 7);
  // H6/A9: plan up to 12 months ahead of the current month.
  const furthest = addMonths(current, 12);
  return (
    <nav aria-label="Month" className="gutter flex items-center justify-between pt-4">
      <button
        className="min-h-11 min-w-11 text-sage-700"
        onClick={() => onChange(addMonths(month, -1))}
      >
        ‹ {monthName(addMonths(month, -1), false).slice(0, 3)}
      </button>
      <h1 className="type-title">{monthName(month, month.slice(0, 4) !== current.slice(0, 4))}</h1>
      <button
        className="min-h-11 min-w-11 text-sage-700 disabled:opacity-0"
        disabled={month >= furthest}
        onClick={() => onChange(addMonths(month, 1))}
      >
        {monthName(addMonths(month, 1), false).slice(0, 3)} ›
      </button>
    </nav>
  );
}

function GroupSection({
  group,
  rows,
  byId,
  month,
  editable,
  onEdit,
}: {
  group: CategoryGroup;
  rows: ViewCategory[];
  byId: Map<string, Category>;
  month: string;
  editable: boolean;
  onEdit: (row: ViewCategory) => void;
}) {
  const [open, setOpen] = useState(true);
  const available = rows.reduce((n, r) => n + r.availableCents, 0);
  const spent = rows.reduce((n, r) => n + r.spentCents, 0);
  return (
    <section className="mt-8">
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="gutter flex min-h-11 w-full items-baseline justify-between text-left"
      >
        <h2 className="type-label text-ink-muted">
          <span aria-hidden className="mr-1 inline-block w-3">
            {open ? '▾' : '▸'}
          </span>
          {group.name}
        </h2>
        <span className="type-caption text-ink-muted">
          <MoneyText cents={spent} tone="muted" /> of <MoneyText cents={available} tone="muted" />
        </span>
      </button>
      {open && (
        <ul>
          {rows
            .sort(
              (a, b) =>
                (byId.get(a.categoryId)?.sortOrder ?? 0) - (byId.get(b.categoryId)?.sortOrder ?? 0),
            )
            .map((r) => (
              <BudgetRow
                key={r.categoryId}
                row={r}
                category={byId.get(r.categoryId)}
                month={month}
                editable={editable}
                onEdit={() => onEdit(r)}
              />
            ))}
        </ul>
      )}
    </section>
  );
}

function BudgetRow({
  row,
  category,
  month,
  editable,
  onEdit,
}: {
  row: ViewCategory;
  category: Category | undefined;
  month: string;
  editable: boolean;
  onEdit: () => void;
}) {
  const over = row.remainingCents < 0;
  return (
    <li className="gutter border-b border-hairline py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          to={`/budget/${row.categoryId}?m=${month}`}
          className="flex min-h-11 min-w-0 items-center gap-2 font-medium"
        >
          {category?.emoji && (
            <span aria-hidden className="text-xl leading-none">
              {category.emoji}
            </span>
          )}
          <span className="truncate">{category?.name ?? 'Category'}</span>
        </Link>
        <span className="shrink-0 text-right">
          {row.carriedInCents !== 0 && (
            <>
              <MoneyText
                cents={row.carriedInCents}
                tone={row.carriedInCents < 0 ? 'over' : 'muted'}
                whole
                sign="always"
              />
              <span className="mx-1 text-ink-faint">▸</span>
            </>
          )}
          <MoneyText
            cents={row.remainingCents}
            tone={over ? 'over' : 'ink'}
            className="font-semibold"
          />
          <span className="ml-1 type-caption text-ink-muted">{over ? 'over' : 'left'}</span>
        </span>
      </div>
      <div className="mt-2">
        <Rail
          carriedInCents={row.carriedInCents}
          plannedCents={row.plannedCents}
          spentCents={row.spentCents}
          availableCents={row.availableCents}
          tick={row.spendShape === 'linear' ? (row.pace?.tick ?? null) : null}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="type-caption text-ink-muted">
          <MoneyText cents={row.spentCents} tone="muted" /> spent
          {row.pace && row.pace.status === 'over' && row.spendShape === 'linear' && (
            <span className="text-clay"> · ahead of pace</span>
          )}
        </span>
        {editable ? (
          <button
            onClick={onEdit}
            aria-label={`Planned for ${category?.name ?? 'category'}: ${formatCents(row.plannedCents)}. Change`}
            className="-my-1 flex min-h-11 items-center gap-1.5 rounded-full bg-sage-100 px-3.5 text-sage-700 active:bg-sage-300"
          >
            <MoneyText
              cents={row.plannedCents}
              className="font-semibold text-sage-700"
              whole={row.plannedCents % 100 === 0}
            />
            <span className="type-caption">planned</span>
          </button>
        ) : (
          <span className="type-caption text-ink-muted">
            <MoneyText cents={row.plannedCents} tone="muted" /> planned
          </span>
        )}
      </div>
    </li>
  );
}

function CloseControl({ month, data }: { month: string; data: PeriodResponse }) {
  const invalidate = useInvalidateMoney();
  const [confirm, setConfirm] = useState<'close' | 'override' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = monthName(addMonths(month, 1), false);
  const name = monthName(month, false);

  const run = async (path: string, body?: unknown) => {
    setError(null);
    try {
      await api('POST', `/periods/${month}/${path}`, body);
      setConfirm(null);
      await invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not do that.');
    }
  };

  if (data.period.status === 'closed') {
    if (!data.period.needsRecalc) return null;
    return (
      <section className="gutter mb-6">
        <div className="rounded-card bg-clay-100 p-4">
          <p className="text-ink">
            <MoneyText cents={data.period.recalcDeltaCents} /> of spending landed in {name} after it
            closed. Its carry into {next} still uses the old numbers.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => run('recalculate')}>Recalculate carry into {next}</Button>
            <Button variant="quiet" onClick={() => run('dismiss-recalc')}>
              Leave as is
            </Button>
          </div>
          {error && <p className="mt-2 text-clay">{error}</p>}
        </div>
      </section>
    );
  }
  if (!data.close.ended) return null;
  const waiting = data.close.readiness.waitingOn;
  return (
    <section className="gutter mb-6">
      <div className="rounded-card bg-sage-100 p-4">
        <p className="font-medium">{name} has ended.</p>
        {waiting.length > 0 ? (
          <p className="mt-1 text-ink-muted">
            Waiting on{' '}
            {waiting
              .map(
                (w) =>
                  `${w.name} (last reported ${w.lastSyncedDate ? shortDate(w.lastSyncedDate) : 'never'})`,
              )
              .join(', ')}{' '}
            to report past month end.
          </p>
        ) : (
          <p className="mt-1 text-ink-muted">Every budget account has reported. Ready to close.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setConfirm(waiting.length > 0 ? 'override' : 'close')}>
            {waiting.length > 0 ? 'Close anyway' : `Close ${name}`}
          </Button>
        </div>
        {error && <p className="mt-2 text-clay">{error}</p>}
      </div>
      <Sheet open={confirm !== null} title={`Close ${name}?`} onClose={() => setConfirm(null)}>
        <p className="text-ink-muted">
          Closing freezes what each category carries into {next}: leftovers and overspending carry,
          bill leftovers return to the pool. Spending that arrives later won't change it unless you
          ask to recalculate.
        </p>
        {confirm === 'override' && (
          <p className="mt-3 text-clay">
            {waiting.map((w) => w.name).join(', ')} {waiting.length === 1 ? "hasn't" : "haven't"}{' '}
            reported past month end, so {name} may be missing spending.
          </p>
        )}
        <Button
          className="mt-6 w-full"
          onClick={() => run('close', { override: confirm === 'override' })}
        >
          Close {name}
        </Button>
      </Sheet>
    </section>
  );
}

function Upcoming({
  month,
  today,
  categories,
}: {
  month: string;
  today: string;
  categories: Category[];
}) {
  const recurring = useRecurring();
  const rows = (recurring.data ?? []).filter(
    (s) =>
      s.status !== 'ended' &&
      s.nextExpectedDate?.slice(0, 7) === month &&
      s.expectedAmountCents > 0,
  );
  const broken = (recurring.data ?? []).filter((s) => s.status === 'broken');
  if (rows.length === 0 && broken.length === 0) return null;
  return (
    <section className="gutter mt-10">
      <h2 className="type-title">Recurring</h2>
      <ul className="mt-2">
        {rows.map((s) => (
          <li
            key={s.id}
            className="flex min-h-12 items-center justify-between border-b border-hairline py-3"
          >
            <span>
              {s.merchantNormalized}
              <span className="block type-caption text-ink-faint">
                {s.nextExpectedDate && s.nextExpectedDate < today ? 'Due' : 'Expected'}{' '}
                {shortDate(s.nextExpectedDate ?? '')}
                {s.categoryId
                  ? ` · ${categories.find((c) => c.id === s.categoryId)?.name ?? ''}`
                  : ''}
              </span>
            </span>
            <MoneyText cents={s.expectedAmountCents} />
          </li>
        ))}
        {broken.map((s) => (
          <li key={s.id} className="min-h-12 border-b border-hairline py-3 text-clay">
            {s.merchantNormalized} hasn't charged since it was due{' '}
            {shortDate(s.nextExpectedDate ?? '')}.
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The month's reallocation log (T38). */
function Moves({ month, categories }: { month: string; categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const log = useQuery({
    queryKey: ['period', month, 'moves'],
    queryFn: () => get<Reallocation[]>(`/periods/${month}/reallocations`),
  });
  const moves = (log.data ?? []).filter((r) => r.fromCategoryId && r.toCategoryId);
  if (moves.length === 0) return null;
  const name = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Pool';
  return (
    <section className="gutter mt-10">
      <button
        className="flex min-h-12 w-full items-center justify-between border-y border-hairline"
        onClick={() => setOpen(true)}
      >
        <span>Money moved this month</span>
        <span className="text-ink-muted">{moves.length} ›</span>
      </button>
      <Sheet open={open} title="Money moved" onClose={() => setOpen(false)}>
        <ul>
          {moves.map((m) => (
            <li key={m.id} className="border-b border-hairline py-3">
              <div className="flex justify-between">
                <span>
                  {name(m.fromCategoryId)} → {name(m.toCategoryId)}
                </span>
                <MoneyText cents={m.amountCents} />
              </div>
              <span className="type-caption text-ink-faint">
                {shortDate(m.createdAt.slice(0, 10))}
                {m.note ? ` · ${m.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}

function EmptyBudget({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="gutter mt-10">
      <div className="border-l-2 border-gold pl-4">
        <p className="type-title">Start with what you spend on.</p>
        <p className="mt-2 text-ink-muted">
          Groceries, gas, eating out, rent. Each gets a plan and a rail; whatever's left carries
          into next month.
        </p>
        <Button className="mt-4" onClick={onAdd}>
          Add your first category
        </Button>
      </div>
    </section>
  );
}

function BudgetSkeleton() {
  return (
    <div className="gutter mx-auto max-w-2xl pt-6">
      <Skeleton className="mx-auto h-7 w-40" />
      <Skeleton className="mt-6 h-4 w-28" />
      <Skeleton className="mt-2 h-11 w-48" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mt-8">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-3 h-2 w-full" />
        </div>
      ))}
    </div>
  );
}
