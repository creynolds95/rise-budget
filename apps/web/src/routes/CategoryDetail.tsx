import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { CategoryEditSheet } from '../components/CategoryEditSheet';
import { usePlanFlow } from '../components/PlanFlow';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow, ValueRow } from '../components/primitives/Rows';
import { IconButton } from '../components/primitives/Icon';
import { FillBar } from '../components/primitives/FillBar';
import { Rail } from '../components/primitives/Rail';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { earnedBars, yearBars, type MonthSpend } from '../lib/plan';
import { monthEnd, monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import { backFrom } from '../lib/nav';
import {
  useCategories,
  useGroups,
  useInvalidateMoney,
  usePeriod,
  useToday,
  useTransactions,
} from '../lib/queries';

/** Switches the month on screen by rewriting `?m=`, keeping every other param. */
function useMonthPicker() {
  const [, setParams] = useSearchParams();
  const today = useToday().slice(0, 7);
  return (m: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (m === today) n.delete('m');
        else n.set('m', m);
        return n;
      },
      { replace: true },
    );
}

/** T42. The hero is the number — available this month — never a chart. */
export function CategoryDetail() {
  const { categoryId = '' } = useParams();
  const [params] = useSearchParams();
  const today = useToday();
  const month = params.get('m') ?? today.slice(0, 7);
  // Opened from somewhere other than the Budget (the Dashboard), the back control says so.
  const back = backFrom(params.get('from'), {
    label: 'Budget',
    to: month === today.slice(0, 7) ? '/budget' : `/budget?m=${month}`,
  });
  const onMonth = useMonthPicker();
  return <CategoryDetailBody categoryId={categoryId} month={month} back={back} onMonth={onMonth} />;
}

/**
 * The category detail content, shared by the mobile full-page push (`CategoryDetail`
 * above) and the desktop master/detail panel (`CategoryDetailPanel` in Budget.tsx) — same
 * five-zone template, same logic, just a different `back` target.
 */
function CategoryDetailBody({
  categoryId,
  month,
  back,
  onMonth,
}: {
  categoryId: string;
  month: string;
  back: { label: string; to: string };
  onMonth: (m: string) => void;
}) {
  const today = useToday();
  const period = usePeriod(month);
  const categories = useCategories();
  const history = useQuery({
    queryKey: ['category-history', categoryId, 13],
    queryFn: () => get<MonthSpend[]>(`/categories/${categoryId}/history?months=13`),
  });
  const txns = useTransactions({ category: categoryId, from: `${month}-01`, to: monthEnd(month) });
  const [forgiving, setForgiving] = useState(false);
  const [editingCat, setEditingCat] = useState(false);
  const groups = useGroups();
  const navigate = useNavigate();
  const plan = usePlanFlow(month, categories.data ?? []);

  const cat = categories.data?.find((c) => c.id === categoryId);
  const isIncome = groups.data?.find((g) => g.id === cat?.groupId)?.kind === 'income';
  const row = period.data?.categories.find((c) => c.categoryId === categoryId);
  if (!cat || !row || !period.data) {
    return (
      <DetailPage
        header={{ back, title: cat?.name ?? '' }}
        identity={{ label: 'Available this month', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }
  const open = true;
  // Income is stored as negative spending (SPEC §1.1); show it as what came in.
  const earnedCents = isIncome ? -row.spentCents : row.spentCents;
  const remainingCents = isIncome ? row.availableCents - earnedCents : row.remainingCents;
  const list = txns.data?.pages.flatMap((p) => p.items) ?? [];
  const yearly = yearBars(history.data ?? [], month);
  const bars = isIncome ? earnedBars(yearly) : yearly;
  const name = monthName(month, false);

  return (
    <>
      <DetailPage
        header={{
          back,
          title: `${cat.emoji ? `${cat.emoji} ` : ''}${cat.name}`,
          action: (
            <IconButton icon="pencil" label="Edit category" onClick={() => setEditingCat(true)} />
          ),
        }}
        shape={
          <MonthBars bars={bars} selected={month} loading={history.isPending} onPick={onMonth} />
        }
        factsTitle="Summary"
        facts={
          <>
            <ValueRow label={isIncome ? `Left to earn in ${name}` : `Left in ${name}`}>
              <MoneyText
                cents={remainingCents}
                balance
                tone={remainingCents < 0 && !isIncome ? 'over' : 'ink'}
              />
            </ValueRow>
            {(cat.rolloverPolicy === 'roll' || row.carriedInCents !== 0) && (
              <ValueRow label="Rolled over from last month">
                <MoneyText
                  cents={row.carriedInCents}
                  balance
                  tone={row.carriedInCents < 0 ? 'over' : 'ink'}
                />
              </ValueRow>
            )}
            <div className="border-b border-hairline py-3">
              {isIncome ? (
                <FillBar filledCents={earnedCents} targetCents={row.availableCents} tick={null} />
              ) : (
                <Rail
                  carriedInCents={row.carriedInCents}
                  plannedCents={row.plannedCents}
                  spentCents={row.spentCents}
                  availableCents={row.availableCents}
                  tick={null}
                />
              )}
            </div>
            <ValueRow
              label="Planned"
              {...(open ? { onClick: () => plan.open(cat, row, period.data?.poolCents ?? 0) } : {})}
            >
              <MoneyText cents={row.plannedCents} whole={row.plannedCents % 100 === 0} />
            </ValueRow>
            <ValueRow label={isIncome ? 'Earned' : 'Total amount'}>
              <MoneyText cents={earnedCents} />
            </ValueRow>
            {list.length > 0 && !txns.hasNextPage && (
              <ValueRow label="Average transaction">
                <MoneyText cents={Math.round(earnedCents / list.length)} />
              </ValueRow>
            )}
            {month === today.slice(0, 7) && row.carriedInCents < 0 && (
              <div className="py-3">
                <Button
                  variant="quiet"
                  className="w-full bg-sage-100"
                  onClick={() => setForgiving(true)}
                >
                  Reset rollover
                </Button>
              </div>
            )}
          </>
        }
        related={{
          title: 'Transactions',
          children: (
            <>
              {list.length === 0 && <p className="py-3 text-ink-muted">Nothing filed here yet.</p>}
              {list.slice(0, 5).map((t) => (
                <TxnRow key={t.id} t={t} from={`${cat.name}|/budget/${categoryId}`} />
              ))}
              {list.length > 5 && (
                <NavRow
                  to={`/transactions?category=${categoryId}`}
                  label={`All ${list.length}${txns.hasNextPage ? '+' : ''} transactions`}
                />
              )}
            </>
          ),
        }}
      />
      {plan.sheets}
      <CategoryEditSheet
        category={editingCat ? cat : null}
        groups={groups.data ?? []}
        onClose={() => setEditingCat(false)}
        onDeleted={() => navigate(back.to)}
      />
      <ForgiveSheet
        open={forgiving}
        onClose={() => setForgiving(false)}
        categoryId={categoryId}
        name={cat.name}
        amountCents={-row.carriedInCents}
        month={month}
      />
    </>
  );
}

/**
 * The desktop master/detail panel (H5): same five-zone content as the mobile push, just
 * placed beside the category list instead of replacing it. "Close" clears the panel by
 * dropping `?category=` rather than navigating away from `/budget`.
 */
export function CategoryDetailPanel({ categoryId, month }: { categoryId: string; month: string }) {
  const today = useToday();
  const back = {
    label: 'Close',
    to: month === today.slice(0, 7) ? '/budget' : `/budget?m=${month}`,
  };
  const onMonth = useMonthPicker();
  return <CategoryDetailBody categoryId={categoryId} month={month} back={back} onMonth={onMonth} />;
}

/** SPEC §2.8: the confirm names the amount and asks why. */
function ForgiveSheet({
  open,
  onClose,
  categoryId,
  name,
  amountCents,
  month,
}: {
  open: boolean;
  onClose: () => void;
  categoryId: string;
  name: string;
  amountCents: number;
  month: string;
}) {
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} title="Forgive the deficit?" onClose={onClose}>
      <p className="text-ink-muted">
        {name} carried <MoneyText cents={-amountCents} tone="over" /> into {monthName(month, false)}
        . Forgiving it sets that to $0: the overspending stays in history, but stops reducing this
        month.
      </p>
      <label className="mt-4 flex flex-col gap-1">
        <span className="type-label text-ink-muted">Why</span>
        <input
          className="min-h-11 rounded-input border border-hairline bg-surface px-3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Birthday dinner, one-off"
        />
      </label>
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        variant="danger"
        className="mt-6 w-full border border-clay"
        disabled={!reason.trim()}
        onClick={async () => {
          try {
            await api('POST', `/categories/${categoryId}/forgive`, { amountCents, reason });
            await invalidate();
            onClose();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not forgive.');
          }
        }}
      >
        Forgive {formatCents(amountCents)}
      </Button>
    </Sheet>
  );
}

/** Twelve months of spending, the one on screen picked out. */
function MonthBars({
  bars,
  selected,
  loading,
  onPick,
}: {
  bars: MonthSpend[];
  selected: string;
  loading: boolean;
  onPick: (m: string) => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.spentCents));
  const H = 120;
  return (
    <figure className="m-0" aria-label="Spending by month">
      <div className="flex items-end gap-1.5" style={{ height: H }}>
        {bars.map((b) => {
          const h = loading ? 6 : Math.max(Math.round((Math.max(b.spentCents, 0) / max) * H), 4);
          return (
            <button
              type="button"
              key={b.periodId}
              aria-label={`${monthName(b.periodId, false)}: ${formatCents(b.spentCents)}`}
              aria-pressed={b.periodId === selected}
              disabled={loading}
              onClick={() => onPick(b.periodId)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                title={`${monthName(b.periodId, false)}: ${formatCents(b.spentCents)}`}
                className={`w-full rounded-t-[5px] rounded-b-[2px] ${
                  loading
                    ? 'animate-pulse bg-hairline'
                    : b.periodId === selected
                      ? 'bg-sage-600'
                      : 'bg-sage-300'
                }`}
                style={{ height: h }}
              />
            </button>
          );
        })}
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1.5">
        {bars.map((b) => (
          <span
            key={b.periodId}
            className={`min-w-0 flex-1 text-center text-[10px] tracking-wide uppercase ${
              b.periodId === selected ? 'font-semibold text-ink' : 'text-ink-faint'
            }`}
          >
            {monthName(b.periodId, false).slice(0, 3)}
          </span>
        ))}
      </div>
    </figure>
  );
}
