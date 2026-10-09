import { Loading } from '../components/Pending';
import type { RecurringSeries } from '@rise/shared/schemas';
import { merchantName } from '../lib/merchant';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardTile } from '@rise/shared/schemas';
import { Link, useNavigate } from 'react-router';
import { NetWorthSection } from './Accounts';
import { surplusTone } from '../lib/surplus';
import { SummaryCard } from './Budget';
import { SpendingSection, WhereItWent } from '../components/SpendingSection';
import { HealthNotes } from '../components/HealthNotes';
import { quietInstitutions, StaleNotes } from '../components/StaleNotes';
import { MissedRow, useMissed } from '../components/MissedCharges';
import { TxnRow } from '../components/TxnRow';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { Icon } from '../components/primitives/Icon';
import { CustomizeDashboard } from '../components/CustomizeDashboard';
import {
  DebtTile,
  InvestmentsTile,
  MortgageScheduleTile,
  MortgageYearTile,
  RetirementTile,
  SavingsTile,
} from '../components/DashboardTiles';
import { tileOrder } from '../lib/dashboard';
import { useHeaderActions } from '../lib/headerActions';
import { get } from '../lib/api';
import { addMonths, shortDate } from '../lib/dates';
import { transitionClick } from '../lib/transition';
import {
  useAccounts,
  useBackupStatus,
  useUsage,
  useCashToPayday,
  useCategories,
  useMe,
  usePeriod,
  useRecurring,
  useSyncStatus,
  useToday,
  useTransactions,
} from '../lib/queries';
import { spreadMonths } from '../lib/spread';

const RECENT_TXNS = 4;

/** A gold call to action that disappears once there is nothing left to review. */
function ReviewRow({ to, count, what }: { to: string; count: number; what: string }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      onClick={transitionClick(navigate, to)}
      className="flex min-h-14 items-center rounded-card border-l-4 border-gold bg-gold-100 px-4 shadow-soft active:brightness-95"
    >
      <span className="type-body font-semibold">
        <span className="money">{count}</span> {what}
      </span>
    </Link>
  );
}

/** "This month, answered" (T41). The on-pace answer first, then what needs attention. */
export function Dashboard() {
  const navigate = useNavigate();
  const today = useToday();
  const month = today.slice(0, 7);
  const me = useMe().data;
  const period = usePeriod(month);
  const last = usePeriod(addMonths(month, -1));
  const accounts = useAccounts();
  const recurring = useRecurring();
  const broken = useMissed(recurring.data);
  const surplus = useCashToPayday();
  const categories = useCategories();
  const txns = useTransactions({ sort: 'date_desc' });
  const syncStatus = useSyncStatus();
  const backups = useBackupStatus();
  const usage = useUsage();
  const [customizing, setCustomizing] = useState(false);
  useHeaderActions(
    <button
      type="button"
      aria-label="Customize dashboard"
      onClick={() => setCustomizing(true)}
      className="flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
    >
      <Icon name="sliders" />
    </button>,
  );
  const queue = useQuery({
    queryKey: ['queue-count'],
    queryFn: () => get<{ count: number }>('/review/count'),
  });

  if (!period.data) {
    return (
      <Loading>
        <div className="gutter mx-auto max-w-2xl pt-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-11 w-56" />
          <Skeleton className="mt-2 h-4 w-64" />
          <Skeleton className="mt-10 h-12 w-full" />
          <Skeleton className="mt-2 h-12 w-full" />
        </div>
      </Loading>
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
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;
  const recentTxns = (txns.data?.pages[0]?.items ?? []).slice(0, RECENT_TXNS);
  const reviewCount = queue.data?.count ?? 0;
  const surplusReviewCount = surplus.data?.suggestions.length ?? 0;

  const tiles: Record<DashboardTile, ReactNode> = {
    review:
      reviewCount > 0 || surplusReviewCount > 0 ? (
        <div className="flex flex-col gap-2">
          {reviewCount > 0 && (
            <ReviewRow
              to="/review"
              count={reviewCount}
              what={reviewCount === 1 ? 'transaction to review' : 'transactions to review'}
            />
          )}
          {surplusReviewCount > 0 && (
            <ReviewRow
              to="/cash-to-payday#review"
              count={surplusReviewCount}
              what="to review in Surplus"
            />
          )}
        </div>
      ) : null,
    surplus: (
      <section>
        <h2 className="type-title">Surplus</h2>
        <Link
          to="/cash-to-payday"
          onClick={transitionClick(navigate, '/cash-to-payday')}
          className="mt-1 block overflow-hidden rounded-card bg-surface p-4 shadow-soft active:bg-sage-100"
        >
          {!surplus.data ? (
            <Loading compact>
              <Skeleton className="h-11 w-40" />
            </Loading>
          ) : surplus.data.paySchedules.length === 0 ? (
            <p className="type-display text-ink-muted">Confirm your pay dates</p>
          ) : (
            <MoneyText
              cents={surplus.data.freeToMoveCents}
              tone={surplusTone(surplus.data.freeToMoveCents)}
              className="type-display"
              whole
            />
          )}
        </Link>
      </section>
    ),
    budget: (
      <section>
        <h2 className="type-title">Budget</h2>
        <div className="mt-2">
          <SummaryCard p={p} expenseCarriedCents={expenseCarriedCents} to="/budget" />
        </div>
      </section>
    ),
    spending: (
      <SpendingSection
        month={month}
        spentCents={t.spentCents}
        elapsedDays={p.pace.elapsedDays}
      />
    ),
    whereItWent: (
      <WhereItWent
        month={month}
        categories={p.categories}
        lastCategories={last.data?.categories}
        names={categories.data}
      />
    ),
    transactions: (
      <section aria-labelledby="txns-h">
        <h2 id="txns-h" className="type-title">
          Transactions
        </h2>
        <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          {!txns.data ? (
            <Loading compact>
              <Skeleton className="mt-3 h-12 w-full" />
              <Skeleton className="mt-2 h-12 w-full" />
            </Loading>
          ) : recentTxns.length === 0 ? (
            <p className="py-4 text-ink-muted">No transactions yet.</p>
          ) : (
            recentTxns.map((tx) => {
              const c =
                spreadMonths(tx) > 1 || tx.splits.length === 1
                  ? byId.get(tx.splits[0]?.categoryId ?? '')
                  : undefined;
              return <TxnRow key={tx.id} t={tx} categoryEmoji={c?.emoji} from="Dashboard|/" />;
            })
          )}
        </div>
        <NavRow to="/transactions" label="Most recent" />
      </section>
    ),
    netWorth: (
      <section>
        <NetWorthSection to="/accounts" />
      </section>
    ),
    comingUp:
      upcoming.length > 0 || broken.length > 0 ? (
        <section>
          <h2 className="type-title">Coming up</h2>
          <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {upcoming.map((s) => (
              <li
                key={s.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-3"
              >
                <span>
                  {merchantName(s)}
                  <span className="ml-2 type-caption text-ink-faint">
                    {shortDate(s.nextExpectedDate ?? '')}
                    {catName(s.categoryId) ? ` · ${catName(s.categoryId)}` : ''}
                  </span>
                </span>
                <MoneyText cents={s.expectedAmountCents} />
              </li>
            ))}
            {broken.map((s) => (
              <MissedRow key={s.id} s={s} today={today} all={recurring.data ?? []} />
            ))}
          </ul>
        </section>
      ) : null,
    investments: <InvestmentsTile />,
    savings: <SavingsTile />,
    retirement: <RetirementTile />,
    debt: <DebtTile />,
    mortgageSchedule: <MortgageScheduleTile />,
    mortgageYear: <MortgageYearTile />,
  };
  const order = tileOrder(me?.settings.dashboard ?? null);
  const visible = order.all.filter((id) => order.shown.has(id) && tiles[id]);

  return (
    <div className="gutter mx-auto max-w-2xl pt-6 pb-12">
      <HealthNotes
        sync={syncStatus.data}
        backups={backups.data}
        today={today}
        quiet={quietInstitutions(accounts.data ?? [])}
        usage={usage.data}
        dismissible
      />
      {accounts.data && (
        <StaleNotes accounts={accounts.data} today={today} tz={me?.timezone} dismissible />
      )}
      <div className="flex flex-col gap-8">
        {visible.map((id) => (
          <div key={id}>{tiles[id]}</div>
        ))}
      </div>
      <CustomizeDashboard open={customizing} onClose={() => setCustomizing(false)} />
    </div>
  );
}
