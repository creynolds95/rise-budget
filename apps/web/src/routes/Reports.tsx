import { averageCents } from '@rise/shared/reports';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { series as seriesColors } from '../design/tokens';
import { pieArcs, squarifyTreemap, type Slice } from '../lib/chart';
import { addMonths, monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useCashFlowReport, useCategories, useMoneyFlow, useToday } from '../lib/queries';
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

/** How many months the bar charts (and the "all" summary) cover; matches the API's window. */
const WINDOW = 6;

/** "May – Oct 2026", or "Dec 2025 – May 2026" across a year boundary. */
function rangeLabel(from: string, to: string): string {
  const fromYear = from.slice(0, 4) !== to.slice(0, 4);
  return `${short(from)}${fromYear ? ` ${from.slice(0, 4)}` : ''} – ${short(to)} ${to.slice(0, 4)}`;
}

/**
 * Reports: cash flow and spending, each with a chart picker. One period drives every chart
 * and the Summary: a single month (the arrows, or tapping a bar) or the whole six-month
 * window (tapping the selected bar again, or "6 months").
 */
export function Reports() {
  const today = useToday();
  const thisMonth = today.slice(0, 7);
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? thisMonth;
  const all = params.get('all') === '1';
  const [view, setView] = useState<ViewKey>('flow');
  const [flowChart, setFlowChart] = useState<FlowChart>('sankey');
  const [spendingChart, setSpendingChart] = useState<SpendingChart>('pie');
  const select = (m: string, wholeWindow = false) => {
    const next: Record<string, string> = {};
    if (m !== thisMonth) next.m = m;
    if (wholeWindow) next.all = '1';
    setParams(next, { replace: true });
  };
  // The window ends this month while the selection is inside it, else at the selection.
  const end = month >= addMonths(thisMonth, 1 - WINDOW) ? thisMonth : month;
  const start = addMonths(end, 1 - WINDOW);
  const from = all ? start : month;
  const to = all ? end : month;
  const label = all
    ? rangeLabel(start, end)
    : monthName(month, month.slice(0, 4) !== today.slice(0, 4));
  const period: Period = { from, to, label, selected: all ? null : month };
  const tapMonth = (m: string) => select(m, !all && m === month);

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <nav aria-label="Month" className="gutter flex items-center justify-between pt-4">
        <button
          className="min-h-11 min-w-11 text-sage-700"
          onClick={() => select(addMonths(month, -1))}
        >
          ‹ {short(addMonths(month, -1))}
        </button>
        <h1 className="type-title">{label}</h1>
        <button
          className="min-h-11 min-w-11 text-sage-700 disabled:opacity-0"
          disabled={month >= thisMonth}
          onClick={() => select(addMonths(month, 1))}
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
        {view === 'flow' && flowChart === 'sankey' && (
          <MoneyFlowReportView month={to} from={from} label={label} />
        )}
        {view === 'flow' && flowChart === 'bar' && (
          <CashFlowBarView end={end} period={period} onTap={tapMonth} />
        )}
        {view === 'spending' && spendingChart === 'pie' && <SpendingPieView period={period} />}
        {view === 'spending' && spendingChart === 'bar' && (
          <SpendingBarView end={end} period={period} onTap={tapMonth} thisMonth={thisMonth} />
        )}
        {view === 'spending' && spendingChart === 'treemap' && (
          <SpendingTreemapView period={period} />
        )}
      </section>

      <section className="gutter mt-3">
        <Summary
          end={end}
          period={period}
          onMonth={() => select(month)}
          onAll={() => select(month, true)}
        />
      </section>
    </div>
  );
}

/** What every chart and the Summary show: one month, or the whole window. */
interface Period {
  from: string;
  to: string;
  label: string;
  /** The month picked, or null when the whole window is. */
  selected: string | null;
}

// ── Summary ─────────────────────────────────────────────────────────────────────

function Summary({
  end,
  period,
  onMonth,
  onAll,
}: {
  end: string;
  period: Period;
  onMonth: () => void;
  onAll: () => void;
}) {
  const report = useCashFlowReport(end).data;
  const months = report?.months.filter((m) => m.periodId >= period.from && m.periodId <= period.to);
  const income = months?.reduce((n, m) => n + m.incomeCents, 0) ?? 0;
  const expense = months?.reduce((n, m) => n + m.expenseCents, 0) ?? 0;
  const net = income - expense;
  const rows = [
    { label: 'Income', cents: income, tone: 'in' as const },
    { label: 'Expenses', cents: expense, tone: 'ink' as const },
    { label: 'Savings', cents: net, tone: net < 0 ? ('over' as const) : ('ink' as const) },
  ];

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="type-title">Summary</h2>
          <p className="type-caption text-ink-muted">{period.label}</p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-input bg-canvas p-0.5">
          {[
            { key: 'month', label: 'Month', on: period.selected !== null, go: onMonth },
            { key: 'all', label: `${WINDOW} months`, on: period.selected === null, go: onAll },
          ].map((o) => (
            <button
              key={o.key}
              aria-pressed={o.on}
              onClick={o.go}
              className={`min-h-9 rounded-input px-3 type-caption font-semibold ${
                o.on ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between border-t border-hairline py-3 first:border-t-0"
          >
            <dt>{r.label}</dt>
            <dd>
              {report ? (
                <MoneyText cents={r.cents} tone={r.tone} whole />
              ) : (
                <Skeleton className="h-5 w-20" />
              )}
            </dd>
          </div>
        ))}
      </dl>
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

function CashFlowBarView({
  end,
  period,
  onTap,
}: {
  end: string;
  period: Period;
  onTap: (m: string) => void;
}) {
  const report = useCashFlowReport(end).data;
  if (!report) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Income vs. expenses</p>
      <div className="mt-4">
        <MonthBars
          months={report.months.map((m) => ({
            periodId: m.periodId,
            bars: [
              { cents: m.incomeCents, fill: 'var(--color-sage-600)', name: 'income' },
              { cents: m.expenseCents, fill: 'var(--color-clay)', name: 'expenses' },
            ],
          }))}
          net={report.months.map((m) => m.incomeCents - m.expenseCents)}
          selected={period.selected}
          onTap={onTap}
        />
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
    </div>
  );
}

const CF_W = 320;
const CF_H = 160;

interface MonthColumn {
  periodId: string;
  bars: { cents: number; fill: string; name: string }[];
}

/**
 * Side-by-side bars per month, each month a button: tapping one selects it, and the rest
 * fade. `net`, when given, draws the cumulative savings line over the bars.
 */
function MonthBars({
  months,
  net,
  selected,
  onTap,
}: {
  months: MonthColumn[];
  net?: number[];
  selected: string | null;
  onTap: (m: string) => void;
}) {
  const max = Math.max(1, ...months.flatMap((m) => m.bars.map((b) => b.cents)));
  const slot = CF_W / Math.max(months.length, 1);
  const per = months[0]?.bars.length ?? 1;
  const barW = (slot * 0.64) / per;
  const running = net?.reduce<number[]>((acc, v) => {
    acc.push((acc.at(-1) ?? 0) + v);
    return acc;
  }, []);
  const netMax = Math.max(1, ...(running ?? []).map(Math.abs));
  const netY = (v: number) => CF_H - ((v + netMax) / (netMax * 2)) * CF_H;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${CF_W} ${CF_H}`}
          aria-hidden
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
            const left = i * slot + slot / 2 - (barW * per) / 2;
            const faded = selected !== null && m.periodId !== selected;
            return (
              <g key={m.periodId} opacity={faded ? 0.35 : 1}>
                {m.bars.map((b, j) => {
                  const h = (Math.max(0, b.cents) / max) * (CF_H - 8);
                  return (
                    <rect
                      key={b.name}
                      x={left + j * barW + 0.5}
                      width={barW - 1}
                      y={CF_H - h}
                      height={h}
                      rx={2}
                      fill={b.fill}
                    />
                  );
                })}
              </g>
            );
          })}
          {running && (
            <polyline
              points={running.map((v, i) => `${i * slot + slot / 2},${netY(v)}`).join(' ')}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex">
          {months.map((m) => (
            <button
              key={m.periodId}
              aria-pressed={m.periodId === selected}
              aria-label={`${monthName(m.periodId)}: ${m.bars
                .map((b) => `${b.name} ${formatCents(b.cents)}`)
                .join(', ')}`}
              onClick={() => onTap(m.periodId)}
              className="flex-1"
            />
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-1 flex justify-between type-caption">
        {months.map((m) => (
          <button
            key={m.periodId}
            tabIndex={-1}
            onClick={() => onTap(m.periodId)}
            className={`min-h-9 flex-1 text-center ${
              m.periodId === selected ? 'font-semibold text-ink' : 'text-ink-faint'
            }`}
          >
            {short(m.periodId)}
          </button>
        ))}
      </div>
    </figure>
  );
}

// ── Spending: shared category data ──────────────────────────────────────────────

const MAX_SLICES = 6;

/** Top categories by spend over the period, capped with the rest in "Everything else". */
function useSpendingSlices(period: Period): { slices: Slice[]; total: number } | undefined {
  const flow = useMoneyFlow(period.to, period.from).data;
  const categories = useCategories().data;
  return useMemo(() => {
    if (!flow || !categories) return undefined;
    const name = new Map(flow.nodes.map((n) => [n.id, n.name]));
    const cat = (id: string) => categories.find((c) => `cat:${c.id}` === id);
    const named = flow.links
      .filter((l) => l.source.startsWith('group:'))
      .sort((a, b) => b.valueCents - a.valueCents)
      .map((l) => {
        const info = cat(l.target);
        return {
          label: info
            ? `${info.emoji ? info.emoji + ' ' : ''}${info.name}`
            : (name.get(l.target) ?? 'Category'),
          cents: l.valueCents,
        };
      });
    const head = named.slice(0, MAX_SLICES);
    const restCents = named.slice(MAX_SLICES).reduce((n, s) => n + s.cents, 0);
    const slices: Slice[] = head.map((s, i) => ({ ...s, color: colorAt(i) }));
    if (restCents > 0)
      slices.push({ label: 'Everything else', cents: restCents, color: colorAt(head.length) });
    return { slices, total: named.reduce((n, s) => n + s.cents, 0) };
  }, [flow, categories]);
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

function SpendingEmpty({ period }: { period: Period }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="text-ink-muted">Nothing spent, {period.label}.</p>
    </div>
  );
}

// ── Spending: Pie ────────────────────────────────────────────────────────────────

function SpendingPieView({ period }: { period: Period }) {
  const data = useSpendingSlices(period);
  if (!data) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data.slices.length === 0) return <SpendingEmpty period={period} />;
  const cx = 160;
  const cy = 90;
  const arcs = pieArcs(data.slices, cx, cy, 78, 46);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending by category, {period.label}</p>
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

function SpendingBarView({
  end,
  period,
  onTap,
  thisMonth,
}: {
  end: string;
  period: Period;
  onTap: (m: string) => void;
  thisMonth: string;
}) {
  const report = useCashFlowReport(end).data;
  if (!report) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const complete = report.months.filter((m) => m.periodId !== thisMonth && m.expenseCents !== 0);
  const avg = averageCents(complete.map((m) => m.expenseCents));

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending per month</p>
      {avg !== null && (
        <p className="mt-1 text-ink-muted">
          Typical month: <MoneyText cents={avg} whole />
        </p>
      )}
      <div className="mt-4">
        <MonthBars
          months={report.months.map((m) => ({
            periodId: m.periodId,
            bars: [{ cents: m.expenseCents, fill: 'var(--color-sage-600)', name: 'spending' }],
          }))}
          selected={period.selected}
          onTap={onTap}
        />
      </div>
    </div>
  );
}

// ── Spending: Treemap ────────────────────────────────────────────────────────────

const TM_W = 320;
const TM_H = 200;

function SpendingTreemapView({ period }: { period: Period }) {
  const data = useSpendingSlices(period);
  if (!data) {
    return (
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data.slices.length === 0) return <SpendingEmpty period={period} />;
  const tiles = squarifyTreemap(data.slices, TM_W, TM_H);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Spending by category, {period.label}</p>
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
