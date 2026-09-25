import { averageCents } from '@rise/shared/reports';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Chart } from '../components/primitives/Chart';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { addMonths, monthName } from '../lib/dates';
import { useCategories, usePeriod, useSpendingReport, useToday } from '../lib/queries';
import { MoneyFlowReportView } from './MoneyFlow';

const VIEWS = [
  { key: 'flow', label: 'Money flow' },
  { key: 'trend', label: 'Trend' },
  { key: 'category', label: 'By category' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

const short = (period: string) => monthName(period, false).slice(0, 3);

/** Desktop-first "Reports" tab: the money flow chart plus spending trend and category breakdown views. */
export function Reports() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? today.slice(0, 7);
  const [view, setView] = useState<ViewKey>('flow');
  const setMonth = (m: string) =>
    setParams(m === today.slice(0, 7) ? {} : { m }, { replace: true });

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <nav aria-label="Month" className="gutter flex items-center justify-between pt-4">
        <button
          className="min-h-11 min-w-11 text-sage-700"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹ {short(addMonths(month, -1))}
        </button>
        <h1 className="type-title">{monthName(month, month.slice(0, 4) !== today.slice(0, 4))}</h1>
        <button
          className="min-h-11 min-w-11 text-sage-700 disabled:opacity-0"
          disabled={month >= today.slice(0, 7)}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          {short(addMonths(month, 1))} ›
        </button>
      </nav>

      <div className="gutter mt-4 flex gap-1 overflow-hidden rounded-card bg-surface p-1 shadow-soft">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`min-h-9 flex-1 rounded-input type-caption font-semibold ${
              view === v.key ? 'bg-sage-600 text-surface' : 'text-ink-muted'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <section className="gutter mt-4">
        {view === 'flow' && <MoneyFlowReportView month={month} />}
        {view === 'trend' && <TrendView month={month} />}
        {view === 'category' && <CategoryView month={month} />}
      </section>
    </div>
  );
}

function TrendView({ month }: { month: string }) {
  const report = useSpendingReport(month).data;
  if (!report) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const firstWithData = report.months.findIndex((m) => m.cents !== 0);
  const shown = firstWithData === -1 ? [] : report.months.slice(firstWithData);
  const complete = shown.filter((m) => m.periodId !== month);
  const avg = complete.length > 0 ? averageCents(complete.map((m) => m.cents)) : undefined;

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending per month</p>
      {complete.length === 0 ? (
        <p className="mt-2 text-ink-muted">Not enough history yet to show a trend.</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

function CategoryView({ month }: { month: string }) {
  const period = usePeriod(month).data;
  const categories = useCategories().data;
  if (!period || !categories) {
    return (
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-2 h-12 w-full" />
      </div>
    );
  }
  const spent = period.categories
    .filter((c) => c.groupKind === 'expense' && c.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents);
  if (spent.length === 0) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <p className="text-ink-muted">Nothing spent yet in {monthName(month, false)}.</p>
      </div>
    );
  }
  const max = spent[0]?.spentCents ?? 1;
  const cat = (id: string) => categories.find((c) => c.id === id);

  return (
    <ul className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
      {spent.map((c) => {
        const info = cat(c.categoryId);
        return (
          <li key={c.categoryId} className="border-b border-hairline py-3 last:border-b-0">
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
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-sage-100">
              <span
                className={`block h-full rounded-full ${c.remainingCents < 0 ? 'bg-clay' : 'bg-sage-600'}`}
                style={{ width: `${Math.max(2, (c.spentCents / max) * 100)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
