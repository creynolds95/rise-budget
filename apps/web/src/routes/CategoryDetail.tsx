import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { CategoryEditSheet } from '../components/CategoryEditSheet';
import { usePlanFlow } from '../components/PlanFlow';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Chart } from '../components/primitives/Chart';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, NavRow, StaticRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import type { Range } from '../lib/chart';
import { monthEnd, monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import {
  useCategories,
  useGroups,
  useInvalidateMoney,
  usePeriod,
  useToday,
  useTransactions,
} from '../lib/queries';

const RANGE_MONTHS: Record<Range, number> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  YTD: 12,
  '1Y': 12,
  ALL: 36,
};

/** T42. The hero is the number — available this month — never a chart. */
export function CategoryDetail() {
  const { categoryId = '' } = useParams();
  const [params] = useSearchParams();
  const today = useToday();
  const month = params.get('m') ?? today.slice(0, 7);
  const period = usePeriod(month);
  const categories = useCategories();
  const [range, setRange] = useState<Range>('6M');
  const months = range === 'YTD' ? Number(today.slice(5, 7)) : RANGE_MONTHS[range];
  const history = useQuery({
    queryKey: ['category-history', categoryId, months],
    queryFn: () =>
      get<{ periodId: string; spentCents: number }[]>(
        `/categories/${categoryId}/history?months=${months}`,
      ),
  });
  const txns = useTransactions({ category: categoryId, from: `${month}-01`, to: monthEnd(month) });
  const [forgiving, setForgiving] = useState(false);
  const [editingCat, setEditingCat] = useState(false);
  const groups = useGroups();
  const navigate = useNavigate();
  const plan = usePlanFlow(month, categories.data ?? []);

  const cat = categories.data?.find((c) => c.id === categoryId);
  const row = period.data?.categories.find((c) => c.categoryId === categoryId);
  const back = {
    label: 'Budget',
    to: month === today.slice(0, 7) ? '/budget' : `/budget?m=${month}`,
  };
  if (!cat || !row || !period.data) {
    return (
      <DetailPage
        header={{ back, title: cat?.name ?? '' }}
        identity={{ label: 'Available this month', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }
  const open = period.data.period.status === 'open';
  const list = txns.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <DetailPage
        header={{
          back,
          title: `${cat.emoji ? `${cat.emoji} ` : ''}${cat.name}`,
          action: (
            <button
              onClick={() => setEditingCat(true)}
              className="min-h-11 px-1 font-medium text-sage-700"
            >
              Edit
            </button>
          ),
        }}
        identity={{
          label: `Left in ${monthName(month, false)}`,
          hero: (
            <MoneyText cents={row.remainingCents} tone={row.remainingCents < 0 ? 'over' : 'ink'} />
          ),
          context: (
            <>
              <MoneyText cents={row.availableCents} tone="muted" /> available ·{' '}
              <MoneyText cents={row.spentCents} tone="muted" /> spent
            </>
          ),
        }}
        shape={
          <Chart
            kind="bar"
            label={`${cat.name} spending by month`}
            bars={(history.data ?? []).map((h) => ({
              label: monthName(h.periodId, false).slice(0, 3),
              cents: h.spentCents,
            }))}
            range={range}
            onRange={setRange}
          />
        }
        facts={
          <>
            <EditRow
              label="Planned"
              field={
                open ? (
                  <button
                    onClick={() => plan.open(cat, row, period.data?.poolCents ?? 0)}
                    aria-label={`Planned for ${cat.name}: ${formatCents(row.plannedCents)}. Change`}
                    className="flex min-h-11 items-center rounded-full bg-sage-100 px-3.5 font-semibold text-sage-700 active:bg-sage-300"
                  >
                    <MoneyText cents={row.plannedCents} className="text-sage-700" />
                  </button>
                ) : (
                  <MoneyText cents={row.plannedCents} />
                )
              }
            />
            <StaticRow
              label="Carried in"
              value={
                <MoneyText
                  cents={row.carriedInCents}
                  tone={row.carriedInCents < 0 ? 'over' : 'ink'}
                />
              }
            />
            <StaticRow
              label="Leftover at month end"
              value={cat.rolloverPolicy === 'roll' ? 'Carries forward' : 'Returns to pool'}
            />
            <StaticRow
              label="Spending pattern"
              value={cat.spendShape === 'fixed' ? 'All at once, like a bill' : 'Through the month'}
            />
            {cat.typicalPostDay && (
              <StaticRow label="Usually posts" value={`Day ${cat.typicalPostDay}`} />
            )}
          </>
        }
        related={{
          title: `Transactions in ${monthName(month, false)}`,
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
        manage={
          open && row.carriedInCents < 0 ? (
            <Button variant="danger" className="-ml-4" onClick={() => setForgiving(true)}>
              Forgive carried deficit of {formatCents(-row.carriedInCents)}
            </Button>
          ) : undefined
        }
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
