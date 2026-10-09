import { isDue } from '@rise/shared/debt';
import { Link, useNavigate } from 'react-router';
import { IconBadge } from '../components/PageHeader';
import { Icon, type IconName } from '../components/primitives/Icon';
import { Chevron } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { useOfflineGap, useSettingsState } from '../components/Pending';
import { useSwipeBack } from '../lib/gestures';
import { formatCents } from '../lib/money';
import { useAccounts, useMe, useToday } from '../lib/queries';
import { groupView, owedCents, planLoans } from '../lib/debt';
import { equityOf, homeAccount, mortgageView } from '../lib/mortgage';
import { monthName, periodOf } from '../lib/dates';
import { goalView } from '../lib/savings';
import { defaultTaxYear } from '../lib/tax';
import { retirementView, totalMonthly } from '../lib/retirement';
import { transitionClick } from '../lib/transition';

function Tile({
  to,
  title,
  icon,
  state,
  cta = false,
  bar,
}: {
  to: string;
  title: string;
  icon: IconName;
  state: string | undefined;
  /** An area not started yet: the state becomes a gold button, since it wants a look. */
  cta?: boolean;
  bar?: { pct: number; caption: string } | undefined;
}) {
  const navigate = useNavigate();
  return (
    <li>
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="block rounded-card bg-surface p-4 shadow-soft active:bg-sage-100"
      >
        <span className="flex items-center gap-3">
          <IconBadge>
            <Icon name={icon} size={18} />
          </IconBadge>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">{title}</span>
          </span>
          {!cta && (
            <span className="shrink-0 text-ink-muted money">
              {state ?? <Skeleton className="h-5 w-24" />}
            </span>
          )}
          {cta ? (
            <span className="rounded-button bg-gold-100 px-4 py-2 font-medium text-gold-text">
              {state}
            </span>
          ) : (
            <Chevron />
          )}
        </span>
        {bar && (
          <span className="mt-3 block">
            <span className="block h-2 overflow-hidden rounded-full bg-hairline">
              <span
                className="block h-full rounded-full bg-sage-600"
                style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%` }}
              />
            </span>
            <span className="mt-1.5 block type-caption text-ink-muted money">{bar.caption}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

const binderState = (n: number) =>
  n === 0 ? 'Start one' : `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** The hub: one tile per area of financial health, each opening its own page. */
export function FinancialHealth() {
  useSwipeBack('/');
  const me = useMe().data;
  const accounts = useAccounts().data;
  const plan = me?.settings.retirement ?? null;
  const today = useToday();
  const ready = me !== undefined && accounts !== undefined;
  // "Set up" is a claim about the plan; only make it from settings known to be current.
  const setUp = useSettingsState() === 'current' ? 'Set up' : '—';
  const gap = useOfflineGap();
  let state: string | undefined;
  let debtState: string | undefined;
  let savingsState: string | undefined;
  let mortgageState: string | undefined;
  let mortgageBar: { pct: number; caption: string } | undefined;
  let retireBar: { pct: number; caption: string } | undefined;
  if (ready) {
    const goals = me.settings.savings?.goals ?? [];
    const fund = goals.find((g) => g.kind === 'emergency');
    const fundView = fund ? goalView(fund, accounts, periodOf(today), goals) : null;
    savingsState =
      fundView?.covered != null
        ? `${fundView.covered} months covered`
        : goals.length > 0
          ? `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}`
          : setUp;
    const debt = me.settings.debt;
    const student = debt
      ? groupView(
          planLoans(debt, accounts, 'student'),
          { extraCents: debt.extraCents, strategy: debt.strategy, rollForward: debt.rollForward },
          periodOf(today),
        )
      : null;
    debtState =
      student && student.rows.length > 0
        ? student.debtFreePeriod
          ? `Debt-free ${monthName(student.debtFreePeriod)}`
          : 'Add payments'
        : setUp;
    const loan = debt?.loans.find((l) => l.group === 'mortgage');
    const acct = loan ? accounts.find((a) => a.id === loan.accountId && !a.archivedAt) : undefined;
    if (debt && loan && acct) {
      const v = mortgageView(
        loan,
        owedCents(acct.balanceCents),
        debt,
        periodOf(today),
        acct.source === 'manual' &&
          isDue({ ...loan, owedCents: owedCents(acct.balanceCents) }, today),
      );
      const term = debt.mortgageTermMonths;
      if (term > 0)
        mortgageBar = {
          pct: Math.round((v.paidCount * 100) / term),
          caption: `${Math.round((v.paidCount * 100) / term)}% paid`,
        };
      const home = homeAccount(accounts, debt.homeValueAccountId);
      mortgageState = home
        ? `${formatCents(equityOf(home.balanceCents, owedCents(acct.balanceCents)).cents, { whole: true })} equity`
        : v.payoffPeriod
          ? `Paid off ${monthName(v.payoffPeriod)}`
          : 'Add payment';
    } else mortgageState = setUp;
    if (!plan) state = setUp;
    else {
      const ids = accounts.filter((a) => a.kind === 'investment' && !a.archivedAt).map((a) => a.id);
      const start = accounts
        .filter((a) => ids.includes(a.id))
        .reduce((n, a) => n + a.balanceCents, 0);
      const monthly = totalMonthly(plan, ids);
      const v = retirementView(plan, start, monthly, plan.goalAge);
      state = `${formatCents(monthly, { whole: true })}/mo`;
      if (v.pctOfGoal !== null)
        retireBar = {
          pct: v.pctOfGoal,
          caption: v.pctOfGoal >= 100 ? 'On track for your goal' : `${v.pctOfGoal}% of your goal`,
        };
    }
  } else if (gap) {
    state = debtState = mortgageState = savingsState = '—';
  }
  const todo = (v: string | undefined) => v === 'Set up' || v === 'Start one';
  return (
    <div className="mx-auto max-w-2xl pb-16">
      <ul className="gutter pt-4 space-y-3">
        <Tile
          to="/financial-health/retirement"
          title="Retirement"
          icon="chart"
          state={state}
          cta={todo(state)}
          bar={retireBar}
        />
        <Tile
          to="/financial-health/debt"
          title="Debt"
          icon="cap"
          state={debtState}
          cta={todo(debtState)}
        />
        <Tile
          to="/financial-health/mortgage"
          title="Mortgage"
          icon="home"
          state={mortgageState}
          cta={todo(mortgageState)}
          bar={mortgageBar}
        />
        <Tile
          to="/financial-health/savings"
          title="Savings"
          icon="piggy"
          state={savingsState}
          cta={todo(savingsState)}
        />
        <Tile
          to="/financial-health/taxes"
          title="Taxes"
          icon="doc"
          state={`${defaultTaxYear(today)} tax year`}
        />
        <Tile
          to="/financial-health/binder"
          title="Binder"
          icon="briefcase"
          state={ready ? binderState(me.settings.binder.entries.length) : undefined}
          cta={ready && me.settings.binder.entries.length === 0}
        />
      </ul>
    </div>
  );
}
