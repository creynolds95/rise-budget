import type { ViewCategory } from '@rise/shared/budget';
import type { Category, CategoryGroup, Reallocation } from '@rise/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AddCategorySheet } from '../components/AddCategorySheet';
import { usePlanFlow } from '../components/PlanFlow';
import { Icon } from '../components/primitives/Icon';
import { Button } from '../components/primitives/Button';
import { FillBar } from '../components/primitives/FillBar';
import { MoneyText } from '../components/primitives/MoneyText';
import { Rail } from '../components/primitives/Rail';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { CategoryDetailPanel } from './CategoryDetail';
import { ApiError, api, get } from '../lib/api';
import { addMonths, monthName, shortDate } from '../lib/dates';
import { useIsDesktop } from '../lib/media';
import { formatCents } from '../lib/money';
import { transitionClick } from '../lib/transition';

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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? today.slice(0, 7);
  const period = usePeriod(month);
  const groups = useGroups();
  const categories = useCategories();
  const invalidate = useInvalidateMoney();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = usePlanFlow(month, categories.data ?? []);
  const isDesktop = useIsDesktop();
  const selected = params.get('category');

  if (!period.data || !groups.data || !categories.data) return <BudgetSkeleton />;
  const p = period.data;
  const closed = p.period.status === 'closed';
  const byId = new Map(categories.data.map((c) => [c.id, c]));
  const expenseGroups = groups.data.filter((g) => g.kind === 'expense');
  const incomeGroups = groups.data.filter((g) => g.kind === 'income');
  const expenseCarriedCents = p.categories.reduce((n, c) => {
    const cat = byId.get(c.categoryId);
    return c.groupKind === 'expense' && cat?.budgeted ? n + c.carriedInCents : n;
  }, 0);

  const selectCategory = (categoryId: string) => {
    const next = new URLSearchParams(params);
    next.set('category', categoryId);
    setParams(next);
  };

  return (
    <div className={selected ? 'lg:flex lg:items-start lg:gap-10 lg:px-8' : ''}>
      <div
        className={`mx-auto max-w-2xl pb-16 ${selected ? 'hidden lg:block lg:mx-0 lg:max-w-[560px] lg:flex-shrink-0' : ''}`}
      >
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
            <div className="-mr-2 flex items-center">
              <Link
                to={`/reports${month === today.slice(0, 7) ? '' : `?m=${month}`}`}
                aria-label="Reports"
                className="flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
              >
                <Icon name="flow" />
              </Link>
              <Link
                to={`/settings/budget?from=${encodeURIComponent(`Budget|/budget${month === today.slice(0, 7) ? '' : `?m=${month}`}`)}`}
                onClick={transitionClick(
                  navigate,
                  `/settings/budget?from=${encodeURIComponent(`Budget|/budget${month === today.slice(0, 7) ? '' : `?m=${month}`}`)}`,
                )}
                aria-label="Budget settings"
                className="flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
              >
                <Icon name="sliders" />
              </Link>
            </div>
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

        <SummaryCard p={p} expenseCarriedCents={expenseCarriedCents} />

        {(error ?? plan.error) && <p className="gutter mt-4 text-clay">{error ?? plan.error}</p>}

        <section className="mt-8">
          {/* Expected income is the sum of the income categories below (Paychecks is the
              source of truth, per Caleb 2026-09-25) — no separate editable total. */}
          <h2 className="gutter type-title">Income</h2>
          {incomeGroups.length > 0 && <ColumnHeadings />}
          {incomeGroups.length === 0 ? (
            <p className="gutter py-3 type-caption text-ink-muted">
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
          ) : (
            incomeGroups.map((g) => (
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
                isDesktop={isDesktop}
                onSelect={selectCategory}
                kind="income"
              />
            ))
          )}
        </section>

        <section className="mt-8">
          <h2 className="gutter type-title">Expenses</h2>
          {expenseGroups.length > 0 && <ColumnHeadings />}
          {expenseGroups.length === 0 ? (
            <EmptyBudget onAdd={() => setAdding(true)} />
          ) : (
            expenseGroups.map((g) => (
              <GroupSection
                key={g.id}
                group={g}
                rows={p.categories.filter((c) => {
                  const cat = byId.get(c.categoryId);
                  // C8: unbudgeted categories (Transfer, Credit Card Payment, Other) have a
                  // real category row for splits and rules, but never a budget line — showing
                  // one here would let the user "plan" money for something that isn't spending.
                  return cat?.groupId === g.id && cat.budgeted;
                })}
                byId={byId}
                month={month}
                editable={!closed}
                onEdit={(row) => {
                  const category = byId.get(row.categoryId);
                  if (category) plan.open(category, row, p.poolCents);
                }}
                isDesktop={isDesktop}
                onSelect={selectCategory}
                kind="expense"
              />
            ))
          )}
        </section>

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
      {/* H5: desktop master/detail — the category detail panel sits beside the list instead
        of pushing over it. On mobile `selected` only ever comes from a desktop selection,
        so this stays hidden there; the mobile push still goes through /budget/:categoryId. */}
      {selected && (
        <div className="hidden border-t border-hairline pt-6 lg:block lg:flex-grow lg:border-t-0 lg:border-l lg:pt-2 lg:pl-10">
          <CategoryDetailPanel categoryId={selected} month={month} />
        </div>
      )}
    </div>
  );
}

/** The collapsible "Summary" tile: Income and Expenses at a glance, before the group cards. */
function SummaryCard({
  p,
  expenseCarriedCents,
}: {
  p: PeriodResponse;
  expenseCarriedCents: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="gutter mt-6">
      <div className="rounded-card bg-surface shadow-soft">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 w-full items-center gap-1 px-4 pt-3 text-left"
        >
          <span aria-hidden className="inline-block w-3">
            {open ? '▾' : '▸'}
          </span>
          <h2 className="type-label text-ink-muted">Summary</h2>
        </button>
        {open && (
          <div className="px-4 pb-1">
            <SummaryRow
              label="Income"
              plannedCents={p.expectedIncomeCents}
              filledCents={p.actualIncomeCents}
              doneLabel="earned"
              tick={p.pace}
              good
            />
            <SummaryRow
              label="Expenses"
              plannedCents={p.totals.plannedCents}
              filledCents={p.totals.spentCents}
              doneLabel="spent"
              tick={p.pace}
              carriedCents={expenseCarriedCents}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  plannedCents,
  filledCents,
  doneLabel,
  tick,
  good = false,
  carriedCents = 0,
}: {
  label: string;
  plannedCents: number;
  filledCents: number;
  doneLabel: string;
  tick: PeriodResponse['pace'];
  /** Income: going past `plannedCents` is a good thing, never an overspend warning. */
  good?: boolean;
  carriedCents?: number;
}) {
  const remainingCents = plannedCents - filledCents;
  const over = remainingCents < 0;
  return (
    <div className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-ink-muted">
          <MoneyText cents={plannedCents} tone="muted" /> planned
        </span>
      </div>
      <div className="mt-1.5">
        <FillBar
          filledCents={filledCents}
          targetCents={plannedCents}
          tick={tick}
          over={!good && over}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between type-caption">
        <span className="text-ink-muted">
          <MoneyText cents={filledCents} tone="muted" /> {doneLabel}
        </span>
        <span className="flex items-center gap-0.5">
          {carriedCents !== 0 && (
            <span className="text-sage-700">
              <Icon name="refresh" size={13} />
            </span>
          )}
          <MoneyText
            cents={Math.abs(remainingCents)}
            tone={over ? (good ? 'in' : 'over') : 'ink'}
            className="font-semibold"
          />
          <span className="ml-1 text-ink-muted">{over ? 'over' : 'remaining'}</span>
        </span>
      </div>
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

/** Column labels once per section (Income/Expenses), over the fixed-width Planned/Remaining columns every row and group total line up under. */
function ColumnHeadings() {
  return (
    <div className="gutter mb-1 mr-4 flex items-center justify-end gap-3 type-caption text-ink-muted">
      <span className="w-[72px] border border-transparent px-2 text-right">Planned</span>
      <span className="w-[72px] border border-transparent px-2 text-right">Remaining</span>
    </div>
  );
}

function GroupSection({
  group,
  rows,
  byId,
  month,
  editable,
  onEdit,
  isDesktop,
  onSelect,
  kind,
}: {
  group: CategoryGroup;
  rows: ViewCategory[];
  byId: Map<string, Category>;
  month: string;
  editable: boolean;
  onEdit: (row: ViewCategory) => void;
  isDesktop: boolean;
  onSelect: (categoryId: string) => void;
  kind: 'income' | 'expense';
}) {
  const [open, setOpen] = useState(true);
  const plannedTotal = rows.reduce((n, r) => n + r.plannedCents, 0);
  const remainingTotal = rows.reduce((n, r) => {
    const earned = kind === 'income' ? -r.spentCents : r.spentCents;
    return n + (kind === 'income' ? r.availableCents - earned : r.remainingCents);
  }, 0);
  const groupOver = remainingTotal < 0;
  return (
    <section className="mt-4 first:mt-0">
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="gutter flex min-h-11 w-full items-center justify-between text-left"
      >
        <h3 className="type-label text-ink-muted">
          <span aria-hidden className="mr-1 inline-block w-3">
            {open ? '▾' : '▸'}
          </span>
          {group.name}
        </h3>
        <span className="mr-4 flex items-center gap-3 text-sm font-semibold">
          <span className="flex w-[72px] items-center justify-end border border-transparent px-2">
            <MoneyText cents={plannedTotal} tone="ink" whole />
          </span>
          <span className="flex w-[72px] items-center justify-end border border-transparent px-2">
            <MoneyText
              cents={Math.abs(remainingTotal)}
              tone={groupOver ? (kind === 'income' ? 'in' : 'over') : 'ink'}
              whole
            />
          </span>
        </span>
      </button>
      {open && (
        <div className="gutter">
          <ul className="overflow-hidden rounded-card bg-surface shadow-soft">
            {rows
              .sort(
                (a, b) =>
                  (byId.get(a.categoryId)?.sortOrder ?? 0) -
                  (byId.get(b.categoryId)?.sortOrder ?? 0),
              )
              .map((r) => (
                <BudgetRow
                  key={r.categoryId}
                  row={r}
                  category={byId.get(r.categoryId)}
                  month={month}
                  editable={editable}
                  onEdit={() => onEdit(r)}
                  isDesktop={isDesktop}
                  onSelect={onSelect}
                  kind={kind}
                />
              ))}
          </ul>
        </div>
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
  isDesktop,
  onSelect,
  kind,
}: {
  row: ViewCategory;
  category: Category | undefined;
  month: string;
  editable: boolean;
  onEdit: () => void;
  isDesktop: boolean;
  onSelect: (categoryId: string) => void;
  kind: 'income' | 'expense';
}) {
  // For income, "spent" is money received, stored negative (SPEC §2.1's engine is spending-
  // shaped); earned/remaining-to-earn flip that back to what the row shows.
  const earnedCents = kind === 'income' ? -row.spentCents : row.spentCents;
  const remainingCents = kind === 'income' ? row.availableCents - earnedCents : row.remainingCents;
  // Earning more than planned is good, never an overspend warning (DESIGN-SYSTEM.md §1).
  const over = remainingCents < 0 && kind !== 'income';
  const navigate = useNavigate();
  const to = `/budget/${row.categoryId}?m=${month}`;
  return (
    <li className="gutter border-b border-hairline last:border-b-0">
      <Link
        to={to}
        onClick={(e) => {
          // H5: desktop opens the category beside the list instead of pushing over it.
          if (isDesktop) {
            e.preventDefault();
            onSelect(row.categoryId);
            return;
          }
          transitionClick(navigate, to)(e);
        }}
        className="block pt-2 active:bg-sage-100"
      >
        <span className="flex min-h-9 min-w-0 items-center gap-1.5 text-sm font-medium">
          {category?.emoji && (
            <span aria-hidden className="text-base leading-none">
              {category.emoji}
            </span>
          )}
          <span className="truncate">{category?.name ?? 'Category'}</span>
        </span>
        <div className="mt-1.5">
          {kind === 'income' ? (
            <FillBar filledCents={earnedCents} targetCents={row.availableCents} tick={null} />
          ) : (
            <Rail
              carriedInCents={row.carriedInCents}
              plannedCents={row.plannedCents}
              spentCents={row.spentCents}
              availableCents={row.availableCents}
              tick={row.spendShape === 'linear' ? (row.pace?.tick ?? null) : null}
            />
          )}
        </div>
      </Link>
      <div className="flex items-center justify-end gap-3 pt-1.5 pb-2">
        {editable ? (
          <button
            onClick={onEdit}
            aria-label={`Planned for ${category?.name ?? 'category'}: ${formatCents(row.plannedCents)}. Change`}
            className="flex min-h-9 w-[72px] items-center justify-end rounded-input border border-hairline px-2 text-sm font-semibold text-ink active:bg-sage-100"
          >
            <MoneyText cents={row.plannedCents} whole={row.plannedCents % 100 === 0} />
          </button>
        ) : (
          <span className="flex min-h-9 w-[72px] items-center justify-end rounded-input border border-hairline px-2 text-sm text-ink-muted">
            <MoneyText cents={row.plannedCents} tone="muted" whole={row.plannedCents % 100 === 0} />
          </span>
        )}
        <span
          aria-label={`${over ? 'Over' : 'Remaining'}: ${formatCents(Math.abs(remainingCents))}`}
          className={`flex min-h-9 w-[72px] items-center justify-end gap-1 rounded-full px-2 text-sm font-semibold ${
            remainingCents === 0
              ? 'bg-sage-100 text-ink-muted'
              : over
                ? 'bg-clay-100 text-clay'
                : 'bg-sage-100 text-sage-700'
          }`}
        >
          {row.carriedInCents !== 0 && (
            <span
              aria-hidden
              title={
                row.carriedInCents < 0
                  ? `Carried a ${formatCents(-row.carriedInCents)} deficit`
                  : `Carried ${formatCents(row.carriedInCents)} forward`
              }
            >
              <Icon name="refresh" size={12} />
            </span>
          )}
          <span className="money">
            {formatCents(Math.abs(remainingCents), { whole: remainingCents % 100 === 0 })}
          </span>
        </span>
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
            {data.period.recalcDeltaCents !== 0 ? (
              <>
                <MoneyText cents={data.period.recalcDeltaCents} /> changed in {name} since it
                closed.
              </>
            ) : (
              <>Money moved between categories in {name} since it closed.</>
            )}{' '}
            Its carry into {next} still uses the old numbers.
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
      <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
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
