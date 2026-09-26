import type { RecurringSeries } from '@rise/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { NetWorthSection } from './Accounts';
import { SummaryCard } from './Budget';
import { SpendingSection } from '../components/SpendingSection';
import { StaleNotes } from '../components/StaleNotes';
import { TxnRow } from '../components/TxnRow';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { get } from '../lib/api';
import { addMonths, shortDate } from '../lib/dates';
import {
  useAccounts,
  useCashToPayday,
  useCategories,
  useMe,
  usePeriod,
  useRecurring,
  useToday,
  useTransactions,
} from '../lib/queries';

const RECENT_TXNS = 4;

/** "This month, answered" (T41). The on-pace answer first, then what needs attention. */
export function Dashboard() {
  const today = useToday();
  const month = today.slice(0, 7);
  const me = useMe().data;
  const period = usePeriod(month);
  const last = usePeriod(addMonths(month, -1));
  const accounts = useAccounts();
  const recurring = useRecurring();
  const surplus = useCashToPayday();
  const categories = useCategories();
  const txns = useTransactions({ sort: 'date_desc' });
  const queue = useQuery({
    queryKey: ['queue-count'],
    queryFn: () => get<{ count: number }>('/review/queue'),
  });

  if (!period.data) {
    return (
      <div className="gutter mx-auto max-w-2xl pt-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-11 w-56" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-10 h-12 w-full" />
        <Skeleton className="mt-2 h-12 w-full" />
      </div>
    );
  }
  const p = period.data;
  const t = p.totals;
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const expenseCarriedCents = p.categories.reduce((n, c) => {
    const cat = byId.get(c.categoryId);
    return c.groupKind === 'expense' && cat?.budgeted ? n + c.carriedInCents : n;
  }, 0);
  const upcoming = (recurring.data ?? []).filter(
    (s: RecurringSeries) =>
      s.status !== 'ended' &&
      s.nextExpectedDate &&
      s.nextExpectedDate >= today &&
      s.nextExpectedDate.slice(0, 7) === month &&
      s.expectedAmountCents > 0,
  );
  const broken = (recurring.data ?? []).filter((s) => s.status === 'broken');
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;
  const recentTxns = (txns.data?.pages[0]?.items ?? []).slice(0, RECENT_TXNS);

  return (
    <div className="gutter mx-auto max-w-2xl pt-6 pb-12">
      {accounts.data && <StaleNotes accounts={accounts.data} today={today} tz={me?.timezone} />}

      {/* 1. Surplus */}
      <section className={accounts.data ? 'mt-8' : ''}>
        <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          <NavRow
            to="/cash-to-payday"
            label={<span className="font-semibold">Surplus</span>}
            value={
              surplus.data && surplus.data.paySchedules.length > 0 ? (
                <MoneyText
                  cents={surplus.data.freeToMoveCents}
                  className="font-semibold text-ink"
                  whole
                />
              ) : undefined
            }
          />
          {(queue.data?.count ?? 0) > 0 && (
            <NavRow
              to="/review"
              label="To review"
              value={
                <span className="rounded-full bg-sage-600 px-2 py-0.5 type-caption font-semibold text-surface money">
                  {queue.data?.count}
                </span>
              }
            />
          )}
          {p.period.needsRecalc && (
            <NavRow
              to="/budget"
              label="A closed month changed"
              value={
                p.period.recalcDeltaCents !== 0 ? (
                  <MoneyText cents={p.period.recalcDeltaCents} />
                ) : undefined
              }
            />
          )}
        </div>
      </section>

      {/* 2. Summary */}
      <section className="mt-8">
        <SummaryCard p={p} expenseCarriedCents={expenseCarriedCents} />
      </section>

      {/* 3. Spending */}
      <SpendingSection
        month={month}
        spentCents={t.spentCents}
        elapsedDays={p.pace.elapsedDays}
        categories={p.categories}
        lastCategories={last.data?.categories}
        names={categories.data}
      />

      {/* 4. Transactions */}
      <section className="mt-10" aria-labelledby="txns-h">
        <h2 id="txns-h" className="type-title">
          Transactions
        </h2>
        <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          {!txns.data ? (
            <>
              <Skeleton className="mt-3 h-12 w-full" />
              <Skeleton className="mt-2 h-12 w-full" />
            </>
          ) : recentTxns.length === 0 ? (
            <p className="py-4 text-ink-muted">No transactions yet.</p>
          ) : (
            recentTxns.map((tx) => {
              const c =
                tx.splits.length === 1 ? byId.get(tx.splits[0]?.categoryId ?? '') : undefined;
              return (
                <TxnRow
                  key={tx.id}
                  t={tx}
                  categoryName={c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : undefined}
                  from="Dashboard|/"
                />
              );
            })
          )}
        </div>
        <NavRow to="/transactions" label="Most recent" />
      </section>

      {/* 5. Net worth trend */}
      <section className="mt-10">
        <NetWorthSection />
      </section>

      {(upcoming.length > 0 || broken.length > 0) && (
        <section className="mt-10">
          <h2 className="type-title">Coming up</h2>
          <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {upcoming.map((s) => (
              <li
                key={s.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-3"
              >
                <span>
                  {s.merchantNormalized}
                  <span className="ml-2 type-caption text-ink-faint">
                    {shortDate(s.nextExpectedDate ?? '')}
                    {catName(s.categoryId) ? ` · ${catName(s.categoryId)}` : ''}
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
      )}
    </div>
  );
}
