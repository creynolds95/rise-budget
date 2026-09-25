import type { ViewCategory } from '@rise/shared/budget';
import { averageCents, cumulativeSpend, sameDayTotal, type MonthSpend } from '@rise/shared/reports';
import type { Category } from '@rise/shared/schemas';
import { Link } from 'react-router';
import { series } from '../design/tokens';
import { addMonths, monthName } from '../lib/dates';
import { useSpendingReport } from '../lib/queries';
import { Chart } from './primitives/Chart';
import { MoneyText } from './primitives/MoneyText';
import { NavRow } from './primitives/Rows';
import { Skeleton } from './primitives/Skeleton';

const TOP = 5;
const short = (period: string) => monthName(period, false).slice(0, 3);
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/**
 * T41 "spend vs last month, reports scrolling in". Three answers, in reading order: am I
 * spending faster than last month (the line), on what (the categories), and is this normal
 * for me (six months). Every comparison is in dollars — no percentages over one month (§7).
 */
export function SpendingSection(props: {
  month: string;
  spentCents: number;
  elapsedDays: number;
  incomeCents: number;
  categories: ViewCategory[];
  lastCategories: ViewCategory[] | undefined;
  names: Category[] | undefined;
}) {
  const { month, elapsedDays } = props;
  const prevMonth = addMonths(month, -1);
  const report = useSpendingReport(month).data;

  return (
    <>
      <section className="mt-10" aria-labelledby="spending-h">
        <h2 id="spending-h" className="type-title">
          Spending
        </h2>
        {report ? (
          <PaceAgainstLastMonth
            month={month}
            prevMonth={prevMonth}
            elapsedDays={elapsedDays}
            spentCents={props.spentCents}
            days={report.days}
          />
        ) : (
          <>
            <Skeleton className="mt-3 h-9 w-40" />
            <Skeleton className="mt-2 h-4 w-64" />
            <Skeleton className="mt-5 h-40 w-full" />
          </>
        )}
      </section>

      <WhereItWent
        categories={props.categories}
        lastCategories={props.lastCategories}
        names={props.names}
        prevMonth={prevMonth}
      />

      {report && <SixMonths months={report.months} month={month} />}

      {props.incomeCents !== 0 && (
        <section className="mt-10" aria-labelledby="flow-h">
          <h2 id="flow-h" className="type-title">
            In and out
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-4">
            <Figure label="Came in">
              <MoneyText cents={props.incomeCents} tone="in" whole />
            </Figure>
            <Figure label="Went out">
              <MoneyText cents={props.spentCents} whole />
            </Figure>
            <Figure label="Difference">
              <MoneyText
                cents={props.incomeCents - props.spentCents}
                tone={props.incomeCents - props.spentCents < 0 ? 'over' : 'ink'}
                sign="always"
                whole
              />
            </Figure>
          </dl>
        </section>
      )}
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="type-label text-ink-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{children}</dd>
    </div>
  );
}

function PaceAgainstLastMonth(props: {
  month: string;
  prevMonth: string;
  elapsedDays: number;
  spentCents: number;
  days: { date: string; cents: number }[];
}) {
  const { month, prevMonth, elapsedDays } = props;
  const current = cumulativeSpend(month, props.days, elapsedDays);
  const previous = cumulativeSpend(prevMonth, props.days);
  const slots = Math.max(current.length, previous.length, 28);
  const byNow = sameDayTotal(previous, elapsedDays);
  const delta = props.spentCents - byNow;
  const hasPrevious = previous.some((c) => c !== 0);
  const name = monthName(month, false);
  const prevName = monthName(prevMonth, false);

  return (
    <>
      <p className="mt-3 money-lg">
        <MoneyText cents={props.spentCents} whole />
      </p>
      <p className="mt-1 text-ink-muted">
        {!hasPrevious ? (
          `Spent so far in ${name}.`
        ) : delta === 0 ? (
          `Level with ${prevName} at this point.`
        ) : (
          <>
            <MoneyText cents={Math.abs(delta)} tone={delta > 0 ? 'over' : 'in'} whole />{' '}
            {delta > 0 ? 'more' : 'less'} than by the {ordinal(elapsedDays)} of {prevName}
          </>
        )}
      </p>
      <div className="mt-5">
        <Chart
          kind="lines"
          label={`Running spending total: ${name} against ${prevName}`}
          slots={slots}
          xLabels={['1', ordinal(Math.ceil(slots / 2)), ordinal(slots)]}
          lines={[
            ...(hasPrevious
              ? [{ label: prevName, values: previous, color: series[1] as string }]
              : []),
            { label: name, values: current, color: series[0] as string, live: true },
          ]}
        />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-caption text-ink-muted">
        <Legend color={series[0]} label={name} />
        {hasPrevious && (
          <Legend color={series[1]} label={prevName}>
            <span>
              <MoneyText cents={previous.at(-1) ?? 0} tone="muted" whole /> all month
            </span>
          </Legend>
        )}
      </ul>
    </>
  );
}

function Legend(props: { color: string; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: props.color }} />
      <span className="font-medium text-ink">{props.label}</span>
      {props.children}
    </li>
  );
}

/** The biggest categories this month, each against itself last month. */
function WhereItWent(props: {
  categories: ViewCategory[];
  lastCategories: ViewCategory[] | undefined;
  names: Category[] | undefined;
  prevMonth: string;
}) {
  const spent = props.categories
    .filter((c) => c.groupKind === 'expense' && c.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents);
  if (spent.length === 0) return null;
  const top = spent.slice(0, TOP);
  const max = top[0]?.spentCents ?? 1;
  const lastBy = new Map((props.lastCategories ?? []).map((c) => [c.categoryId, c.spentCents]));
  const cat = (id: string) => props.names?.find((c) => c.id === id);
  const rest = spent.length - top.length;

  return (
    <section className="mt-10" aria-labelledby="where-h">
      <h2 id="where-h" className="type-title">
        Where it went
      </h2>
      <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        {top.map((c) => {
          const info = cat(c.categoryId);
          const was = lastBy.get(c.categoryId);
          return (
            <li key={c.categoryId} className="border-b border-hairline">
              <Link
                to={`/budget/${c.categoryId}?from=${encodeURIComponent('Dashboard|/')}`}
                className="block py-3 active:bg-sage-100"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {info?.emoji && (
                      <span aria-hidden className="leading-none">
                        {info.emoji}
                      </span>
                    )}
                    <span className="truncate">{info?.name ?? 'Category'}</span>
                  </span>
                  <MoneyText
                    cents={c.spentCents}
                    tone={c.remainingCents < 0 ? 'over' : 'ink'}
                    className="font-semibold"
                    whole
                  />
                </span>
                <span className="mt-2 flex items-center gap-3">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-sage-100">
                    <span
                      className={`block h-full rounded-full ${c.remainingCents < 0 ? 'bg-clay' : 'bg-sage-600'}`}
                      style={{ width: `${Math.max(2, (c.spentCents / max) * 100)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right type-caption text-ink-faint">
                    {was === undefined || was === 0 ? (
                      `none in ${short(props.prevMonth)}`
                    ) : (
                      <>
                        {short(props.prevMonth)} <MoneyText cents={was} tone="muted" whole />
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <NavRow
        to="/budget"
        label={
          rest > 0 ? `${rest} more ${rest === 1 ? 'category' : 'categories'}` : 'Open the budget'
        }
      />
    </section>
  );
}

/** Is this month normal for me? Leading empty months (before any data) are left off. */
function SixMonths({ months, month }: { months: MonthSpend[]; month: string }) {
  const firstWithData = months.findIndex((m) => m.cents !== 0);
  const shown = firstWithData === -1 ? [] : months.slice(firstWithData);
  const complete = shown.filter((m) => m.periodId !== month);
  if (complete.length === 0) return null;
  const avg = averageCents(complete.map((m) => m.cents));
  return (
    <section className="mt-10" aria-labelledby="months-h">
      <h2 id="months-h" className="type-title">
        Month by month
      </h2>
      <p className="mt-1 text-ink-muted">
        {complete.length === 1
          ? `${monthName(complete[0]?.periodId ?? '', false)}: `
          : 'Typical month: '}
        <MoneyText cents={avg ?? 0} whole />
        {complete.length > 1 && (
          <span className="type-caption text-ink-faint"> · average of {complete.length}</span>
        )}
      </p>
      <div className="mt-4">
        <Chart
          kind="bar"
          label={`Spending per month, ${short(shown[0]?.periodId ?? month)} to ${short(month)}`}
          bars={shown.map((m) => ({
            label: short(m.periodId),
            cents: Math.max(0, m.cents),
            muted: m.periodId === month,
          }))}
        />
      </div>
    </section>
  );
}
