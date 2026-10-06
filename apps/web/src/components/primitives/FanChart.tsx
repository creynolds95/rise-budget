import { series } from '../../design/tokens';
import { formatCents } from '../../lib/money';

const W = 320;
const H = 160;

export interface FanPoint {
  age: number;
  p10Cents: number;
  p50Cents: number;
  p90Cents: number;
}

/** 10th–90th percentile band with the median line; `markAge` draws the retirement divider. */
export function FanChart({
  points,
  markAge,
  label,
}: {
  points: FanPoint[];
  markAge?: number;
  label: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.p90Cents));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (c: number) => H - 4 - (c / max) * (H - 8);
  const line = (k: 'p10Cents' | 'p50Cents' | 'p90Cents') =>
    points.map((p, i) => `${x(i)},${y(p[k])}`);
  const band = [...line('p90Cents'), ...line('p10Cents').reverse()].join(' ');
  const mark = markAge === undefined ? -1 : points.findIndex((p) => p.age === markAge);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            className="stroke-hairline"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon points={band} fill={series[0]} fillOpacity={0.18} />
        {mark > 0 && (
          <line
            x1={x(mark)}
            x2={x(mark)}
            y1={0}
            y2={H}
            className="stroke-ink-faint"
            strokeDasharray="2 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={line('p50Cents').join(' ')}
          fill="none"
          stroke={series[0]}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {first && last && (
        <div className="mt-1 flex justify-between type-caption text-ink-faint money">
          <span>Age {first.age}</span>
          <span>{formatCents(max, { whole: true })} max</span>
          <span>Age {last.age}</span>
        </div>
      )}
    </figure>
  );
}
