import { color } from '../../design/tokens';
import { formatCents } from '../../lib/money';

const W = 320;
const H = 160;

export interface FanBand {
  age: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Percentile bands of balance over time: 10–90 outer, 25–75 inner, median line. */
export function FanChart({ label, fan }: { label: string; fan: FanBand[] }) {
  if (fan.length < 2) return null;
  const max = Math.max(1, ...fan.map((p) => p.p90));
  const x = (i: number) => (i / (fan.length - 1)) * W;
  const y = (c: number) => H - (c / max) * (H - 4) - 2;
  const area = (hi: keyof FanBand, lo: keyof FanBand) =>
    [
      ...fan.map((p, i) => `${x(i)},${y(p[hi])}`),
      ...fan.map((p, i) => `${x(fan.length - 1 - i)},${y(fan[fan.length - 1 - i]![lo])}`),
    ].join(' ');
  const last = fan[fan.length - 1]!;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <polygon points={area('p90', 'p10')} fill={color.sage300} opacity={0.35} />
        <polygon points={area('p75', 'p25')} fill={color.sage300} opacity={0.6} />
        <polyline
          points={fan.map((p, i) => `${x(i)},${y(p.p50)}`).join(' ')}
          fill="none"
          stroke={color.sage600}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex justify-between type-caption text-ink-muted money">
        <span>10%: {formatCents(last.p10, { whole: true })}</span>
        <span>Median: {formatCents(last.p50, { whole: true })}</span>
        <span>90%: {formatCents(last.p90, { whole: true })}</span>
      </figcaption>
    </figure>
  );
}
