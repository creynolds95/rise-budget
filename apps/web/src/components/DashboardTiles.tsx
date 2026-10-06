import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { isDue } from '@rise/shared/debt';
import { series } from '../design/tokens';
import { DEFAULT_DEBT_PLAN, groupView, owedCents, planLoans } from '../lib/debt';
import { addMonths, monthName, periodOf } from '../lib/dates';
import { formatCents } from '../lib/money';
import { lineSeries, mortgageView } from '../lib/mortgage';
import { fanView, retirementView, totalMonthly } from '../lib/retirement';
import { goalView } from '../lib/savings';
import { useAccounts, useMe, useToday } from '../lib/queries';
import { transitionClick } from '../lib/transition';
import { Chart } from './primitives/Chart';
import { FanChart } from './primitives/FanChart';
import { MoneyText } from './primitives/MoneyText';
import { Skeleton } from './primitives/Skeleton';
import { chartPoints } from '../routes/Debt';
import { Investments } from '../routes/Investments';
import { Donut, Legend } from '../routes/Mortgage';

/** A titled tile that opens its page; `to` is where tapping the card goes. */
function Tile({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <section>
      <h2 className="type-title">{title}</h2>
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="mt-2 block overflow-hidden rounded-card bg-surface p-4 shadow-soft active:bg-sage-100"
      >
        {children}
      </Link>
    </section>
  );
}

const NotSetUp = () => <p className="text-ink-muted">Not set up</p>;

export function RetirementTile() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const plan = me?.settings.retirement ?? null;
  const view = useMemo(() => {
    if (!plan || !accounts) return null;
    const mine = accounts.filter((a) => a.kind === 'investment' && !a.archivedAt);
    const start = mine.reduce((n, a) => n + a.balanceCents, 0);
    const monthly = totalMonthly(
      plan,
      mine.map((a) => a.id),
    );
    return {
      v: retirementView(plan, start, monthly, plan.goalAge),
      f: fanView(plan, start, monthly, plan.goalAge),
    };
  }, [plan, accounts]);
  return (
    <Tile title="Retirement" to="/financial-health/retirement">
      {!me || !accounts ? (
        <Skeleton className="h-40 w-full" />
      ) : !plan || !view ? (
        <NotSetUp />
      ) : (
        <>
          <p className="type-label text-ink-muted">Monthly spending at {plan.goalAge}</p>
          <p className="type-display">
            <MoneyText cents={view.v.incomeCents} whole />
          </p>
          <div className="mt-3">
            <FanChart
              label="Range of projected balances"
              fan={view.f}
              withdrawalBps={plan.withdrawalBps}
              interactive={false}
            />
          </div>
        </>
      )}
    </Tile>
  );
}

export function DebtTile() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const period = periodOf(today);
  const plan = me?.settings.debt ?? null;
  const student = useMemo(() => {
    if (!plan || !accounts) return null;
    const live = accounts.filter((a) => !a.archivedAt);
    const loans = planLoans(plan, live, 'student');
    if (loans.length === 0) return null;
    return groupView(
      loans,
      { extraCents: plan.extraCents, strategy: plan.strategy, rollForward: plan.rollForward },
      period,
    );
  }, [plan, accounts, period]);
  return (
    <Tile title="Debt payoff" to="/financial-health/debt">
      {!me || !accounts ? (
        <Skeleton className="h-40 w-full" />
      ) : !student ? (
        <NotSetUp />
      ) : (
        <>
          <p className="type-label text-ink-muted">Student loans debt-free</p>
          <p className="type-display money">
            {student.debtFreePeriod ? monthName(student.debtFreePeriod) : '—'}
          </p>
          {student.debtFreePeriod && student.totalOwedByMonth.length > 2 && (
            <div className="mt-3">
              <Chart
                kind="line"
                label="Student loans still owed"
                points={chartPoints(student, period)}
              />
            </div>
          )}
        </>
      )}
    </Tile>
  );
}

/** The mortgage as the Mortgage page computes it; null until a loan and its account exist. */
function useMortgage() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const period = periodOf(today);
  const plan = me?.settings.debt ?? null;
  const loan = plan?.loans.find((l) => l.group === 'mortgage') ?? null;
  const account = loan
    ? accounts?.find((a) => a.id === loan.accountId && !a.archivedAt)
    : undefined;
  return useMemo(() => {
    if (!loan || !account) return { ready: !!me && !!accounts, data: null };
    const owed = owedCents(account.balanceCents);
    const pending = account.source === 'manual' && isDue({ ...loan, owedCents: owed }, today);
    const view = mortgageView(loan, owed, plan ?? DEFAULT_DEBT_PLAN, period, pending);
    return { ready: true, data: { view, owed, pending, period } };
  }, [me, accounts, loan, account, plan, period, today]);
}

export function MortgageScheduleTile() {
  const { ready, data } = useMortgage();
  const lines = data ? lineSeries(data.view.plan, data.owed) : null;
  const last = lines?.months.at(-1) ?? 0;
  const labelAt = (m: number) =>
    data
      ? monthName(addMonths(data.period, m - (data.pending ? 1 : 0))).replace(/^(\w{3})\w* /, '$1 ')
      : '';
  return (
    <Tile title="Mortgage payoff schedule" to="/financial-health/mortgage">
      {!ready ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || !lines ? (
        <NotSetUp />
      ) : (
        <>
          <p className="type-label text-ink-muted">Mortgage paid off</p>
          <p className="type-display money">
            {data.view.payoffPeriod ? monthName(data.view.payoffPeriod) : '—'}
          </p>
          <p className="type-caption text-ink-muted money">
            {formatCents(data.owed, { whole: true })} owed
          </p>
          {lines.months.length > 2 && (
            <div className="mt-3">
              <Chart
                kind="lines"
                label="Balance, principal paid and interest paid over the life of the loan"
                slots={lines.balance.length}
                xLabels={[labelAt(0), labelAt(Math.round(last / 2)), labelAt(last)]}
                lines={[
                  { label: 'Balance', values: lines.balance, color: series[0] },
                  { label: 'Principal to date', values: lines.principal, color: series[3] },
                  { label: 'Interest to date', values: lines.interest, color: series[2] },
                ]}
              />
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-caption text-ink-muted">
                <Legend color={series[0]} label="Balance" />
                <Legend color={series[3]} label="Principal to date" />
                <Legend color={series[2]} label="Interest to date" />
              </ul>
            </div>
          )}
        </>
      )}
    </Tile>
  );
}

export function MortgageYearTile() {
  const { ready, data } = useMortgage();
  const ytd = data?.view.ytd ?? null;
  return (
    <Tile title="Mortgage this year" to="/financial-health/mortgage">
      {!ready ? (
        <Skeleton className="h-40 w-full" />
      ) : !ytd ? (
        <NotSetUp />
      ) : (
        <Donut principal={ytd.principalCents} interest={ytd.interestCents} />
      )}
    </Tile>
  );
}

export function SavingsTile() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const goals = me?.settings.savings?.goals ?? [];
  const views = accounts
    ? goals.map((g) =>
        goalView(
          g,
          accounts.filter((a) => !a.archivedAt),
          periodOf(today),
        ),
      )
    : [];
  return (
    <Tile title="Savings goals" to="/financial-health/savings">
      {!me || !accounts ? (
        <Skeleton className="h-24 w-full" />
      ) : views.length === 0 ? (
        <NotSetUp />
      ) : (
        <ul>
          {views.map((v) => (
            <li key={v.goal.id} className="py-2 first:pt-0 last:pb-0">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{v.goal.name}</span>
                <span className="shrink-0 type-caption text-ink-muted money">
                  {formatCents(v.savedCents, { whole: true })} of{' '}
                  {formatCents(v.targetCents, { whole: true })}
                </span>
              </span>
              <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-canvas">
                <span
                  className="block h-full rounded-full bg-sage-600"
                  style={{ width: `${v.pct}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

export function InvestmentsTile() {
  return (
    <section>
      <Investments compact />
    </section>
  );
}
