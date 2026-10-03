import { Link, useNavigate } from 'react-router';
import { BackLink } from '../components/BackLink';
import { Chevron } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { useSwipeBack } from '../lib/gestures';
import { formatCents } from '../lib/money';
import { useAccounts, useMe, useToday } from '../lib/queries';
import { groupView, planLoans } from '../lib/debt';
import { monthName, periodOf } from '../lib/dates';
import { retirementView, totalMonthly } from '../lib/retirement';
import { transitionClick } from '../lib/transition';

function Tile({ to, title, state }: { to: string; title: string; state: string | undefined }) {
  const navigate = useNavigate();
  return (
    <li className="border-b border-hairline">
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="grid min-h-16 grid-cols-[6.5rem_1fr_auto] items-center gap-x-4 py-3.5 active:bg-sage-100 sm:grid-cols-[9rem_1fr_auto]"
      >
        <span className="type-label text-ink-muted">{title}</span>
        <span className="min-w-0 font-medium money">
          {state ?? <Skeleton className="h-5 w-24" />}
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

/** The hub: one tile per area of financial health, each opening its own page. */
export function FinancialHealth() {
  useSwipeBack('/');
  const me = useMe().data;
  const accounts = useAccounts().data;
  const plan = me?.settings.retirement ?? null;
  const today = useToday();
  const ready = me !== undefined && accounts !== undefined;
  let state: string | undefined;
  let debtState: string | undefined;
  if (ready) {
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
        : debt && debt.loans.length > 0
          ? 'Mortgage only'
          : 'Set up';
    if (!plan) state = 'Set up';
    else {
      const ids = accounts.filter((a) => a.kind === 'investment' && !a.archivedAt).map((a) => a.id);
      const start = accounts
        .filter((a) => ids.includes(a.id))
        .reduce((n, a) => n + a.balanceCents, 0);
      const v = retirementView(plan, start, totalMonthly(plan, ids), plan.goalAge);
      state = `${formatCents(v.incomeCents, { whole: true })}/mo at ${plan.goalAge}`;
    }
  }
  return (
    <div className="mx-auto max-w-2xl pb-16">
      <header className="gutter sticky top-[var(--banner-h,0px)] z-10 grid grid-cols-[1fr_auto_1fr] items-center banner bg-banner text-banner-ink shadow-soft">
        <BackLink to="/" label="Dashboard" />
        <h1 className="type-body font-semibold">Financial health</h1>
        <span />
      </header>
      <ul className="gutter pt-4">
        <Tile to="/financial-health/retirement" title="Retirement" state={state} />
        <Tile to="/financial-health/debt" title="Debt" state={debtState} />
      </ul>
    </div>
  );
}
