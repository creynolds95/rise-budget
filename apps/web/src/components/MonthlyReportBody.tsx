import {
  fallbackHeadlines,
  type MonthlyReport,
  type ReportBenchmarkRow,
  type ReportCategory,
  type ReportData,
  type ReportNarrative,
} from '@rise/shared/report';
import { useState, type ReactNode } from 'react';
import { formatCents } from '../lib/money';
import { monthName } from '../lib/dates';
import { FillBar } from './primitives/FillBar';
import { MoneyText } from './primitives/MoneyText';

export interface ReportControls {
  keySet: boolean;
  writing: boolean;
  failed: boolean;
  onWrite: () => void;
  /** Where weather and gas come from: five digits, or empty. */
  zip: string;
  zipPending: boolean;
  onZip: (zip: string) => void;
  /** A fact from this report the owner can keep for later months; null when there is none. */
  lifeNote: { text: string; pending: boolean; onKeep: () => void; onDismiss: () => void } | null;
}

/**
 * The monthly report (SPEC §12.6): headline tiles first, then one visual per question, each
 * with at most a couple of sentences. Every number is drawn from the computed figures, so the
 * report is complete without a written summary; the summary only adds the sentences. Pure
 * rendering: the app wraps it in queries, the sample-render script in static data.
 */
export function MonthlyReportBody({
  report,
  controls,
}: {
  report: MonthlyReport;
  /** Absent when there is no key (or in a static render): no buttons. */
  controls?: ReportControls | undefined;
}) {
  const month = report.month;
  const d = report.data;
  const n = report.narrative;
  const headlines = n ? n.headlines : fallbackHeadlines(d, (c) => formatCents(c, { whole: true }));
  const empty = d.cash.incomeCents === 0 && d.cash.spentCents === 0;

  return (
    <div className="mt-4 space-y-4" data-testid="monthly-report">
      <Headline d={d} n={n} headlines={headlines} />
      {empty ? (
        <p className="type-body text-ink-muted">Nothing recorded for {monthName(month, true)}.</p>
      ) : (
        <>
          {d.categories.length > 0 && (
            <Card title="Where the money went">
              <CategoryBars rows={d.categories} />
            </Card>
          )}
          {(d.movers.up.length > 0 || d.movers.down.length > 0) && (
            <Card title="What moved" text={n?.movers}>
              <DeltaBars rows={[...d.movers.up, ...d.movers.down]} sparse={d.prevSparse} />
            </Card>
          )}
          {d.weather && (
            <Card title="Weather" text={n?.weather}>
              <Weather w={d.weather} />
            </Card>
          )}
          {d.gas && (
            <Card title="Gas prices" text={n?.gas}>
              <Gas g={d.gas} />
            </Card>
          )}
          {d.yoy.length > 0 && (
            <Card title="Against a year ago" text={n?.yoy}>
              <Yoy rows={d.yoy} />
            </Card>
          )}
          {d.benchmarks.rows.length > 0 && (
            <Card title="Against typical households" text={n?.benchmarks}>
              <ShareBars rows={d.benchmarks.rows} year={d.benchmarks.year} />
            </Card>
          )}
          {(d.netWorth.startCents !== 0 || d.netWorth.endCents !== 0) && (
            <Card title="Net worth" text={n?.netWorth}>
              <Waterfall d={d} />
            </Card>
          )}
          {d.goals.length > 0 && (
            <Card title="Goals" text={n?.goals}>
              <Goals rows={d.goals} />
            </Card>
          )}
          {d.whatsNew.length > 0 && (
            <Card title="What's new" text={n?.whatsNew}>
              <ul className="flex flex-wrap gap-2">
                {d.whatsNew.map((e) => (
                  <li
                    key={e.date + e.text}
                    className="rounded-full bg-sage-100 px-3 py-1 type-caption text-sage-700"
                  >
                    {e.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {controls?.lifeNote && <LifeNote note={controls.lifeNote} />}

      {controls?.keySet && (
        <div className="space-y-2 pt-2">
          <ZipField zip={controls.zip} pending={controls.zipPending} onSave={controls.onZip} />
          <button
            type="button"
            disabled={controls.writing}
            onClick={controls.onWrite}
            className="min-h-11 w-full rounded-input bg-sage-600 type-body font-semibold text-surface disabled:opacity-60"
          >
            {controls.writing ? 'Writing…' : report.narrative ? 'Rewrite summary' : 'Write summary'}
          </button>
          {controls.failed && (
            <p role="alert" className="type-caption text-clay-text">
              The summary could not be written. Try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────────

const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;

function Card({
  title,
  text,
  children,
}: {
  title: string;
  text?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-4 shadow-soft">
      <h2 className="type-label text-ink-muted">{title}</h2>
      <div className="mt-3">{children}</div>
      {text && <p className="mt-3 type-body text-ink">{text}</p>}
    </section>
  );
}

const CHIP = {
  good: 'bg-sage-100 text-sage-700',
  note: 'bg-hairline text-ink',
  watch: 'bg-gold-100 text-gold-text',
} as const;

function Headline({
  d,
  n,
  headlines,
}: {
  d: ReportData;
  n: ReportNarrative | null;
  headlines: string[];
}) {
  const net = d.cash.netCents;
  const tiles: { label: string; cents: number; tone: 'in' | 'over' | 'ink'; sign?: boolean }[] = [
    { label: 'Income', cents: d.cash.incomeCents, tone: 'in' },
    { label: 'Spent', cents: d.cash.spentCents, tone: 'ink' },
    {
      label: net < 0 ? 'Deficit' : 'Surplus',
      cents: Math.abs(net),
      tone: net < 0 ? 'over' : 'in',
    },
  ];
  // Net worth is a change over the month: absent when no balances were recorded.
  if (d.netWorth.startCents !== 0 || d.netWorth.endCents !== 0)
    tiles.push({ label: 'Net worth', cents: d.netWorth.changeCents, tone: 'ink', sign: true });
  return (
    <section className="rounded-card bg-surface p-4 shadow-soft">
      {d.partial && <p className="mb-2 type-label text-gold-text">So far this month</p>}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label}>
            <dt className="type-caption text-ink-muted">{t.label}</dt>
            <dd className="type-title">
              <MoneyText
                cents={t.cents}
                tone={t.tone}
                whole
                {...(t.sign ? { sign: 'always' as const } : {})}
              />
            </dd>
          </div>
        ))}
      </dl>
      {headlines.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {headlines.map((h) => (
            <li key={h} className="flex gap-2 type-body">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sage-600" />
              {h}
            </li>
          ))}
        </ul>
      )}
      {n && n.chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {n.chips.map((c) => (
            <li key={c.text} className={`rounded-full px-3 py-1 type-caption ${CHIP[c.tone]}`}>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {n?.seasonal && <p className="mt-3 type-caption text-ink-muted">{n.seasonal}</p>}
    </section>
  );
}

/** Spend by category: bar length is this month, the tick is last month. */
function CategoryBars({ rows }: { rows: ReportCategory[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.cents, r.prevCents]));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-baseline justify-between gap-3 type-body">
            <span className="truncate">{r.name}</span>
            <MoneyText cents={r.cents} whole />
          </div>
          <div className="relative mt-1 h-2 rounded-full bg-hairline">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-sage-600"
              style={{ width: `${(Math.max(r.cents, 0) / max) * 100}%` }}
            />
            {r.prevCents > 0 && (
              <span
                aria-hidden
                className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
                style={{ left: `${(r.prevCents / max) * 100}%` }}
              />
            )}
          </div>
        </li>
      ))}
      <li className="type-caption text-ink-muted">Tick marks last month</li>
    </ul>
  );
}

/** Biggest swings against last month: right of the line is more spending, left is less. */
function DeltaBars({ rows, sparse }: { rows: ReportCategory[]; sparse: boolean }) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
  const max = Math.max(1, ...sorted.map((r) => Math.abs(r.deltaCents)));
  return (
    <div>
      {sparse && (
        <p className="mb-3 rounded-input bg-gold-100 px-3 py-2 type-caption text-gold-text">
          Last month has far fewer transactions, so these swings are rough.
        </p>
      )}
      <ul className="space-y-3">
        {sorted.map((r) => {
          const up = r.deltaCents > 0;
          const w = (Math.abs(r.deltaCents) / max) * 50;
          return (
            <li key={r.name}>
              <div className="flex items-baseline justify-between gap-3 type-body">
                <span className="truncate">{r.name}</span>
                <MoneyText cents={r.deltaCents} sign="always" whole tone={up ? 'over' : 'in'} />
              </div>
              <div className="relative mt-1 h-2">
                <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
                <span
                  className={`absolute inset-y-0 rounded-full ${up ? 'bg-clay' : 'bg-sage-600'}`}
                  style={up ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Share of spending against the all-household average: two bars per category. */
function ShareBars({ rows, year }: { rows: ReportBenchmarkRow[]; year: number }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.youShareBp, r.avgShareBp]));
  return (
    <div>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <p className="type-body">{r.label}</p>
            {(
              [
                ['You', r.youShareBp, 'bg-sage-600'],
                ['Typical', r.avgShareBp, 'bg-sage-300'],
              ] as const
            ).map(([who, bp, tone]) => (
              <div key={who} className="mt-1 flex items-center gap-2">
                <span className="w-14 shrink-0 type-caption text-ink-muted">{who}</span>
                <div className="h-2 flex-1 rounded-full bg-hairline">
                  <div
                    className={`h-2 rounded-full ${tone}`}
                    style={{ width: `${(bp / max) * 100}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right type-caption money">{pct(bp)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 type-caption text-ink-muted">
        Share of spending. U.S. households, BLS Consumer Expenditure Survey {year}.
      </p>
    </div>
  );
}

/** Start → what moved it → end. Bars float between running totals; gains sage, losses clay. */
function Waterfall({ d }: { d: ReportData }) {
  const { startCents, endCents, bridge } = d.netWorth;
  const steps = [
    { label: 'Contributions', cents: bridge.contributionsCents },
    { label: 'Market', cents: bridge.marketCents },
    { label: 'Debt paid', cents: bridge.debtPaydownCents },
    { label: 'Other', cents: bridge.otherCents },
  ];
  // Running total before each step, to find the vertical extent.
  const bars: { label: string; from: number; to: number; kind: 'total' | 'up' | 'down' }[] = [
    { label: 'Start', from: 0, to: startCents, kind: 'total' },
  ];
  let run = startCents;
  for (const s of steps) {
    bars.push({ label: s.label, from: run, to: run + s.cents, kind: s.cents >= 0 ? 'up' : 'down' });
    run += s.cents;
  }
  bars.push({ label: 'End', from: 0, to: endCents, kind: 'total' });

  // The floor sits just under the lowest running value so small moves stay visible against a
  // large total, instead of vanishing on a zero baseline.
  const values = bars.flatMap((b) => [b.from, b.to]).filter((v) => v !== 0);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const pad = Math.max((hi - lo) * 0.25, 1);
  const floor = lo - pad;
  const H = 120;
  const y = (v: number) => H - ((v - floor) / (hi + pad * 0.2 - floor)) * H;
  const W = 300;
  const bw = W / bars.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="w-full"
        role="img"
        aria-label={`Net worth ${formatCents(startCents, { whole: true })} to ${formatCents(endCents, { whole: true })}`}
      >
        {bars.map((b, i) => {
          const top = y(Math.max(b.from === 0 ? floor : b.from, b.to === 0 ? floor : b.to));
          const bottom = y(Math.min(b.from === 0 ? floor : b.from, b.to === 0 ? floor : b.to));
          const fill =
            b.kind === 'total' ? 'fill-sage-300' : b.kind === 'up' ? 'fill-sage-600' : 'fill-clay';
          return (
            <g key={b.label}>
              <rect
                x={i * bw + bw * 0.15}
                y={top}
                width={bw * 0.7}
                height={Math.max(bottom - top, 2)}
                rx={3}
                className={fill}
              />
              <text
                x={i * bw + bw / 2}
                y={H + 14}
                textAnchor="middle"
                className="fill-ink-muted"
                fontSize={9}
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex items-baseline justify-between type-caption text-ink-muted">
        <MoneyText cents={startCents} whole tone="muted" className="type-caption" />
        <span aria-hidden>→</span>
        <MoneyText cents={endCents} whole tone="muted" className="type-caption" />
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {steps.map((s) => (
          <li key={s.label} className="flex justify-between type-caption">
            <span className="text-ink-muted">{s.label}</span>
            <MoneyText
              cents={s.cents}
              sign="always"
              whole
              tone={s.cents < 0 ? 'over' : 'ink'}
              className="type-caption"
            />
          </li>
        ))}
      </ul>
      {(d.netWorth.sp500Bp !== null || d.netWorth.bondsBp !== null) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {d.netWorth.sp500Bp !== null && (
            <li className="rounded-full bg-hairline px-3 py-1 type-caption money">
              S&amp;P 500 {d.netWorth.sp500Bp >= 0 ? '+' : ''}
              {pct(d.netWorth.sp500Bp)}
            </li>
          )}
          {d.netWorth.bondsBp !== null && (
            <li className="rounded-full bg-hairline px-3 py-1 type-caption money">
              Bonds {d.netWorth.bondsBp >= 0 ? '+' : ''}
              {pct(d.netWorth.bondsBp)}
            </li>
          )}
          {d.netWorth.investmentGrowthBp !== null && (
            <li className="rounded-full bg-sage-100 px-3 py-1 type-caption text-sage-700 money">
              Your investments {d.netWorth.investmentGrowthBp >= 0 ? '+' : ''}
              {pct(d.netWorth.investmentGrowthBp)}
            </li>
          )}
        </ul>
      )}
      {!d.netWorth.contributionsTracked && (
        <p className="mt-3 type-caption text-ink-muted">
          Deposits into investments aren't recorded, so Market includes them.
        </p>
      )}
    </div>
  );
}

function Goals({ rows }: { rows: ReportData['goals'] }) {
  return (
    <ul className="space-y-4">
      {rows.map((g) => (
        <li key={g.name}>
          <div className="flex items-baseline justify-between gap-3 type-body">
            <span className="truncate">{g.name}</span>
            <span className="type-caption money text-ink-muted">{g.pct}%</span>
          </div>
          <div className="mt-1">
            <FillBar filledCents={g.savedCents} targetCents={g.targetCents} tick={null} />
          </div>
          <div className="mt-1 flex justify-between type-caption text-ink-muted">
            <MoneyText cents={g.savedCents} whole tone="muted" className="type-caption" />
            <MoneyText cents={g.targetCents} whole tone="muted" className="type-caption" />
          </div>
        </li>
      ))}
    </ul>
  );
}

type Temps = NonNullable<ReportData['weather']>['month'];

/** Average high and low, this month against last month and a year ago. */
function Weather({ w }: { w: NonNullable<ReportData['weather']> }) {
  const cols: { label: string; t: Temps | null }[] = [
    { label: 'This month', t: w.month },
    { label: 'Last month', t: w.prev },
    { label: 'A year ago', t: w.lastYear },
  ];
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3">
        {cols.map((c) => (
          <div key={c.label}>
            <dt className="type-caption text-ink-muted">{c.label}</dt>
            <dd className="money type-title">{c.t ? `${c.t.avgHighF}°` : '–'}</dd>
            <dd className="money type-caption text-ink-muted">
              {c.t ? `low ${c.t.avgLowF}°` : ''}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 type-caption text-ink-muted">
        Average daily high, °F. Hottest {w.month.maxF}°, coldest night {w.month.minF}°.
      </p>
    </div>
  );
}

function Gas({ g }: { g: NonNullable<ReportData['gas']> }) {
  const cols: { label: string; cents: number | null }[] = [
    { label: 'This month', cents: g.monthCents },
    { label: 'Last month', cents: g.prevCents },
    { label: 'A year ago', cents: g.lastYearCents },
  ];
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3">
        {cols.map((c) => (
          <div key={c.label}>
            <dt className="type-caption text-ink-muted">{c.label}</dt>
            <dd className="type-title">{c.cents === null ? '–' : <MoneyText cents={c.cents} />}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 type-caption text-ink-muted">Regular, per gallon, {g.region} average.</p>
    </div>
  );
}

const YOY_WORD = { new: 'New', gone: 'Gone', up: 'Up', down: 'Down' } as const;

function Yoy({ rows }: { rows: ReportData['yoy'] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="flex items-baseline justify-between gap-3 type-body">
          <span className="truncate">
            {r.name} <span className="type-caption text-ink-muted">{YOY_WORD[r.kind]}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <MoneyText cents={r.lastYearCents} whole tone="muted" className="type-caption" />
            <span aria-hidden className="type-caption text-ink-muted">
              →
            </span>
            <MoneyText cents={r.cents} whole />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A fact the report spotted; kept, it is told to the next months' reports so a change is explained once. */
function LifeNote({ note }: { note: NonNullable<ReportControls['lifeNote']> }) {
  return (
    <section className="rounded-card bg-surface p-4 shadow-soft">
      <h2 className="type-label text-ink-muted">Remember this?</h2>
      <p className="mt-2 type-body">{note.text}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={note.pending}
          onClick={note.onKeep}
          className="min-h-11 flex-1 rounded-input bg-sage-600 type-body font-semibold text-surface disabled:opacity-60"
        >
          Keep for later months
        </button>
        <button
          type="button"
          disabled={note.pending}
          onClick={note.onDismiss}
          className="min-h-11 flex-1 rounded-input bg-hairline type-body disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

/** The ZIP that weather and gas prices are looked up for. Only the ZIP leaves the app. */
function ZipField({
  zip,
  pending,
  onSave,
}: {
  zip: string;
  pending: boolean;
  onSave: (zip: string) => void;
}) {
  const [v, setV] = useState(zip);
  const ok = /^(\d{5})?$/.test(v);
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <label htmlFor="report-zip" className="type-body">
        ZIP for weather and gas
      </label>
      <div className="flex items-center gap-2">
        <input
          id="report-zip"
          inputMode="numeric"
          maxLength={5}
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
          className="money h-11 w-24 rounded-input bg-hairline px-3 text-right type-body"
        />
        <button
          type="button"
          disabled={!ok || pending || v === zip}
          onClick={() => onSave(v)}
          className="min-h-11 rounded-input bg-hairline px-3 type-body disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
