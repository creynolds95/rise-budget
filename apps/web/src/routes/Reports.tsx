import { averageCents } from '@rise/shared/reports';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Chart } from '../components/primitives/Chart';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { series as seriesColors } from '../design/tokens';
import { pieArcs, squarifyTreemap, type Slice } from '../lib/chart';
import { addMonths, monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import {
  useCashFlowReport,
  useCategories,
  usePeriod,
  useSpendingReport,
  useToday,
} from '../lib/queries';
import { MoneyFlowReportView } from './MoneyFlow';

const VIEWS = [
  { key: 'flow', label: 'Cash flow' },
  { key: 'spending', label: 'Spending' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

const FLOW_CHARTS = [
  { key: 'sankey', label: 'Sankey' },
  { key: 'bar', label: 'Bar' },
] as const;
type FlowChart = (typeof FLOW_CHARTS)[number]['key'];

const SPENDING_CHARTS = [
  { key: 'pie', label: 'Pie' },
  { key: 'bar', label: 'Bar' },
  { key: 'treemap', label: 'Treemap' },
] as const;
type SpendingChart = (typeof SPENDING_CHARTS)[number]['key'];

const short = (period: string) => monthName(period, false).slice(0, 3);

/** Categorical color for the Nth slice; the design system's palette is short, so it cycles. */
const colorAt = (i: number) => seriesColors[i % seriesColors.length] as string;

/** Desktop-first "Reports" tab: cash flow and spending, each with a Monarch-style chart picker. */
export function Reports() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? today.slice(0, 7);
  const [view, setView] = useState<ViewKey>('flow');
  const [flowChart, setFlowChart] = useState<FlowChart>('sankey');
  const [spendingChart, setSpendingChart] = useState<SpendingChart>('pie');
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

      <div className="gutter mt-3 flex items-center justify-between">
        <p className="type-label text-ink-muted">Chart</p>
        {view === 'flow' ? (
          <ChartPicker value={flowChart} options={FLOW_CHARTS} onChange={setFlowChart} />
        ) : (
          <ChartPicker
            value={spendingChart}
            options={SPENDING_CHARTS}
            onChange={setSpendingChart}
          />
        )}
      </div>

      <section className="gutter mt-2">
        {view === 'flow' && flowChart === 'sankey' && <MoneyFlowReportView month={month} />}
        {view === 'flow' && flowChart === 'bar' && <CashFlowBarView month={month} />}
        {view === 'spending' && spendingChart === 'pie' && <SpendingPieView month={month} />}
        {view === 'spending' && spendingChart === 'bar' && <SpendingBarView month={month} />}
        {view === 'spending' && spendingChart === 'treemap' && (
          <SpendingTreemapView month={month} />
        )}
      </section>
    </div>
  );
}

function ChartPicker<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: readonly { key: K; label: string }[];
  onChange: (k: K) => void;
}) {
  return (
    <select
      aria-label="Chart type"
      value={value}
      onChange={(e) => onChange(e.target.value as K)}
      className="min-h-11 rounded-input border border-hairline bg-surface px-3 font-semibold text-ink"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Cash flow: Bar ──────────────────────────────────────────────────────────────

function CashFlowBarView({ month }: { month: string }) {
  const report = useCashFlowReport(month).data;
  if (!report) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const totalIncome = report.months.reduce((n, m) => n + m.incomeCents, 0);
  const totalExpense = report.months.reduce((n, m) => n + m.expenseCents, 0);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Income vs. expenses</p>
      <div className="mt-4">
        <CashFlowBars months={report.months} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-4">
        <Figure label="Income" cents={totalIncome} tone="ink" />
        <Figure label="Expenses" cents={totalExpense} tone="ink" />
        <Figure
          label="Savings"
          cents={totalIncome - totalExpense}
          tone={totalIncome - totalExpense < 0 ? 'over' : 'ink'}
        />
      </div>
    </div>
  );
}

function Figure({ label, cents, tone }: { label: string; cents: number; tone: 'ink' | 'over' }) {
  return (
    <div>
      <p className="type-caption text-ink-faint">{label}</p>
      <p className="mt-0.5">
        <MoneyText cents={cents} tone={tone} whole />
      </p>
    </div>
  );
}

const CF_W = 320;
const CF_H = 160;

function CashFlowBars({
  months,
}: {
  months: { periodId: string; incomeCents: number; expenseCents: number }[];
}) {
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.expenseCents]));
  const slot = CF_W / Math.max(months.length, 1);
  const barW = slot * 0.32;
  const net = months.reduce<number[]>((acc, m) => {
    const prev = acc.at(-1) ?? 0;
    acc.push(prev + m.incomeCents - m.expenseCents);
    return acc;
  }, []);
  const netMax = Math.max(1, ...net.map(Math.abs));
  const netY = (v: number) => CF_H - ((v + netMax) / (netMax * 2)) * CF_H;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${CF_W} ${CF_H}`}
        role="img"
        aria-label="Income and expenses per month"
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={CF_W}
            y1={CF_H * f}
            y2={CF_H * f}
            className="stroke-hairline"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {months.map((m, i) => {
          const cx = i * slot + slot / 2;
          const incomeH = (m.incomeCents / max) * (CF_H - 8);
          const expenseH = (m.expenseCents / max) * (CF_H - 8);
          return (
            <g key={m.periodId}>
              <rect
                x={cx - barW - 1}
                width={barW}
                y={CF_H - incomeH}
                height={incomeH}
                rx={2}
                fill="var(--color-sage-600)"
              >
                <title>{`${m.periodId} income: ${formatCents(m.incomeCents)}`}</title>
              </rect>
              <rect
                x={cx + 1}
                width={barW}
                y={CF_H - expenseH}
                height={expenseH}
                rx={2}
                fill="var(--color-clay)"
              >
                <title>{`${m.periodId} expenses: ${formatCents(m.expenseCents)}`}</title>
              </rect>
            </g>
          );
        })}
        <polyline
          points={net.map((v, i) => `${i * slot + slot / 2},${netY(v)}`).join(' ')}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div aria-hidden className="mt-1 flex justify-between type-caption text-ink-faint">
        {months.map((m) => (
          <span key={m.periodId} className="flex-1 text-center">
            {short(m.periodId)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-4 type-caption text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-sage-600" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-clay" /> Expenses
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-ink" /> Savings
          (cumulative)
        </span>
      </div>
    </figure>
  );
}

// ── Spending: shared category data ──────────────────────────────────────────────

const MAX_SLICES = 6;

/** Top categories by spend, capped with the rest bucketed into "Everything else". */
function useSpendingSlices(month: string): { slices: Slice[]; total: number } | undefined {
  const period = usePeriod(month).data;
  const categories = useCategories().data;
  return useMemo(() => {
    if (!period || !categories) return undefined;
    const spent = period.categories
      .filter((c) => c.groupKind === 'expense' && c.spentCents > 0)
      .sort((a, b) => b.spentCents - a.spentCents);
    const cat = (id: string) => categories.find((c) => c.id === id);
    const named = spent.map((c) => {
      const info = cat(c.categoryId);
      return {
        label: info ? `${info.emoji ? info.emoji + ' ' : ''}${info.name}` : 'Category',
        cents: c.spentCents,
      };
    });
    const head = named.slice(0, MAX_SLICES);
    const restCents = named.slice(MAX_SLICES).reduce((n, s) => n + s.cents, 0);
    const slices: Slice[] = head.map((s, i) => ({ ...s, color: colorAt(i) }));
    if (restCents > 0)
      slices.push({ label: 'Everything else', cents: restCents, color: colorAt(head.length) });
    return { slices, total: named.reduce((n, s) => n + s.cents, 0) };
  }, [period, categories]);
}

function SpendingLegend({ slices, total }: { slices: Slice[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? slices : slices.slice(0, 5);
  return (
    <ul className="mt-4 border-t border-hairline pt-3">
      {shown.map((s) => (
        <li key={s.label} className="flex items-center justify-between gap-3 py-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="truncate">{s.label}</span>
          </span>
          <span className="shrink-0 tabular-nums text-ink-muted">
            {formatCents(s.cents)}
            {total > 0 && (
              <span className="ml-1 type-caption text-ink-faint">
                {Math.round((s.cents / total) * 100)}%
              </span>
            )}
          </span>
        </li>
      ))}
      {slices.length > 5 && (
        <li>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="min-h-9 type-caption font-semibold text-sage-700"
          >
            {expanded ? 'Show less' : `Show more (${slices.length - 5})`}
          </button>
        </li>
      )}
    </ul>
  );
}

function SpendingEmpty({ month }: { month: string }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="text-ink-muted">Nothing spent yet in {monthName(month, false)}.</p>
    </div>
  );
}

// ── Spending: Pie ────────────────────────────────────────────────────────────────

function SpendingPieView({ month }: { month: string }) {
  const data = useSpendingSlices(month);
  if (!data) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data.slices.length === 0) return <SpendingEmpty month={month} />;
  const cx = 160;
  const cy = 90;
  const arcs = pieArcs(data.slices, cx, cy, 78, 46);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending by category, {monthName(month, false)}</p>
      <div className="relative mt-2">
        <svg
          viewBox="0 0 320 180"
          role="img"
          aria-label="Spending by category"
          className="h-44 w-full"
        >
          {arcs.map((a) => (
            <path key={a.slice.label} d={a.path} fill={a.slice.color}>
              <title>{`${a.slice.label}: ${formatCents(a.slice.cents)} (${Math.round(a.percent * 100)}%)`}</title>
            </path>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-44 flex-col items-center justify-center">
          <p className="type-caption text-ink-faint">Total</p>
          <p className="type-title tabular-nums">{formatCents(data.total)}</p>
        </div>
      </div>
      <SpendingLegend slices={data.slices} total={data.total} />
    </div>
  );
}

// ── Spending: Bar (monthly totals) ─────────────────────────────────────────────

function SpendingBarView({ month }: { month: string }) {
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

// ── Spending: Treemap ────────────────────────────────────────────────────────────

const TM_W = 320;
const TM_H = 200;

function SpendingTreemapView({ month }: { month: string }) {
  const data = useSpendingSlices(month);
  if (!data) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data.slices.length === 0) return <SpendingEmpty month={month} />;
  const tiles = squarifyTreemap(data.slices, TM_W, TM_H);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending by category, {monthName(month, false)}</p>
      <svg
        viewBox={`0 0 ${TM_W} ${TM_H}`}
        role="img"
        aria-label="Spending by category, sized by amount"
        className="mt-2 h-56 w-full"
      >
        {tiles.map((t) => {
          const pct = data.total > 0 ? Math.round((t.cents / data.total) * 100) : 0;
          const showText = t.width > 44 && t.height > 30;
          return (
            <g key={t.label}>
              <rect
                x={t.x + 1}
                y={t.y + 1}
                width={Math.max(0, t.width - 2)}
                height={Math.max(0, t.height - 2)}
                rx={4}
                fill={t.color}
              >
                <title>{`${t.label}: ${formatCents(t.cents)} (${pct}%)`}</title>
              </rect>
              {showText && (
                <text x={t.x + 8} y={t.y + 18} className="type-caption fill-surface font-semibold">
                  {t.label}
                </text>
              )}
              {showText && (
                <text x={t.x + 8} y={t.y + 34} className="type-caption fill-surface">
                  {formatCents(t.cents)} · {pct}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
