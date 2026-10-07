import { Loading } from '../components/Pending';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { get } from '../lib/api';
import { shortDate } from '../lib/dates';
import {
  growthSeries,
  INV_RANGES,
  invRangeStart,
  signedPct,
  type GrowthPoint,
  type InvRange,
} from '../lib/investments';
import { nearestIndex } from '../lib/chart';
import { useToday } from '../lib/queries';

interface InvestmentsResponse {
  points: { date: string; balanceCents: number; joinedCents: number; inferred: boolean }[];
  accounts: { id: string; name: string; balanceCents: number }[];
  sp500: { date: string; level: number }[] | null;
}

/** Investment accounts against the S&P 500. Balance-based: a deposit reads as growth. */
export function Investments({ compact = false }: { compact?: boolean } = {}) {
  const today = useToday();
  const [range, setRange] = useState<InvRange>('3M');
  // One year is fetched once; the chips just re-slice it.
  const q = useQuery({
    queryKey: ['investments', today],
    queryFn: () =>
      get<InvestmentsResponse>(`/investments?from=${invRangeStart('1Y', today)}&to=${today}`),
  });
  const series = q.data
    ? growthSeries(q.data.points, q.data.sp500, invRangeStart(range, today))
    : [];
  const last = series.at(-1);
  const firstDate = q.data?.points[0]?.date;
  // Rise only has balances from the day it first saw the account, so short history makes
  // every chip show the same line; say so instead of looking broken.
  const shortHistory = firstDate !== undefined && firstDate > invRangeStart(range, today);
  const total = (q.data?.accounts ?? []).reduce((n, a) => n + a.balanceCents, 0);

  if (q.isPending) {
    return (
      <Loading>
        <Skeleton className="h-64 w-full" />
      </Loading>
    );
  }
  if (!q.data || q.data.accounts.length === 0)
    return (
      <p className="text-ink-muted">
        No investment accounts yet. Set an account’s kind to Investment and it appears here.
      </p>
    );
  return (
    <>
      <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
        <p className="type-label text-ink-muted">Investments</p>
        <p className="type-display">
          <MoneyText cents={total} whole />
        </p>
        {last && (
          <p className="mt-1 flex flex-wrap gap-x-4 type-caption">
            <span className="text-sage-700">● Portfolio {signedPct(last.portfolio)}</span>
            {last.sp500 !== null && (
              <span className="text-gold-text">● S&amp;P 500 {signedPct(last.sp500)}</span>
            )}
          </p>
        )}
        <div className="mt-4">
          {series.length > 1 ? (
            <LinesChart series={series} />
          ) : (
            <p className="py-10 text-center text-ink-muted">
              Not enough history in this range yet.
            </p>
          )}
        </div>
        <div role="radiogroup" aria-label="Range" className="mt-2 flex gap-1">
          {INV_RANGES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={r === range}
              onClick={() => setRange(r)}
              className={`min-h-11 flex-1 rounded-full type-caption font-medium ${
                r === range ? 'bg-sage-100 text-sage-700' : 'text-ink-muted'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {shortHistory && firstDate && (
          <p className="mt-2 type-caption text-ink-faint">
            Showing since {shortDate(firstDate)}, the first balance Rise saw.
          </p>
        )}
        {q.data.sp500 === null && (
          <p className="mt-2 type-caption text-ink-faint">
            S&amp;P 500 data is unavailable right now.
          </p>
        )}
      </div>
      {!compact && (
        <>
          <h2 className="mt-6 type-title">Accounts</h2>
          <div className="mt-2 divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
            {q.data.accounts.map((a) => (
              <div key={a.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate">{a.name}</span>
                <MoneyText cents={a.balanceCents} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const W = 320;
const H = 160;

function LinesChart({ series }: { series: GrowthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const vals = series.flatMap((p) => (p.sp500 === null ? [p.portfolio] : [p.portfolio, p.sp500]));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 12);
  const path = (pick: (p: GrowthPoint) => number | null) =>
    series.flatMap((p, i) => {
      const v = pick(p);
      return v === null ? [] : [`${x(i).toFixed(1)},${y(v).toFixed(1)}`];
    });
  const scrub = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setHover(nearestIndex((clientX - r.left) / r.width, series.length));
  };
  const h = hover === null ? null : series[hover];
  return (
    <div className="relative" data-no-swipe>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Portfolio growth against the S&P 500"
        className="block w-full touch-none"
        onPointerDown={(e) => scrub(e.clientX)}
        onPointerMove={(e) => scrub(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="stroke-hairline" strokeDasharray="3 3" />
        <polyline
          fill="none"
          strokeWidth="2"
          className="stroke-gold"
          points={path((p) => p.sp500).join(' ')}
        />
        <polyline
          fill="none"
          strokeWidth="2.5"
          className="stroke-sage-600"
          points={path((p) => p.portfolio).join(' ')}
        />
        {h && hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="stroke-ink-faint" />
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-surface px-2 py-1 type-caption shadow-soft"
          style={{ left: `${Math.min(80, Math.max(20, (hover / (series.length - 1)) * 100))}%` }}
        >
          <p className="text-ink-muted">{shortDate(h.date)}</p>
          <p className="text-sage-700">Portfolio {signedPct(h.portfolio)}</p>
          {h.sp500 !== null && <p className="text-gold-text">S&amp;P 500 {signedPct(h.sp500)}</p>}
        </div>
      )}
    </div>
  );
}
