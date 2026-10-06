import { useState, type PointerEvent } from 'react';
import { color } from '../../design/tokens';
import { nearestIndex } from '../../lib/chart';
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

/**
 * Percentile bands of balance over time: 10–90 outer, 25–75 inner, median line. The readout
 * under it shows the last age; touching or dragging across the chart reads any age.
 */
export function FanChart({
  label,
  fan,
  interactive = true,
}: {
  label: string;
  fan: FanBand[];
  interactive?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (fan.length < 2) return null;
  const max = Math.max(1, ...fan.map((p) => p.p90));
  const x = (i: number) => (i / (fan.length - 1)) * W;
  const y = (c: number) => H - (c / max) * (H - 4) - 2;
  const area = (hi: keyof FanBand, lo: keyof FanBand) =>
    [
      ...fan.map((p, i) => `${x(i)},${y(p[hi])}`),
      ...[...fan].reverse().map((p, i) => `${x(fan.length - 1 - i)},${y(p[lo])}`),
    ].join(' ');
  const at = active ?? fan.length - 1;
  const shown = fan[at] as FanBand;
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActive(nearestIndex((e.clientX - r.left) / Math.max(1, r.width), fan.length));
  };
  return (
    <figure className="m-0">
      <div
        className="relative select-none"
        {...(interactive
          ? {
              style: { touchAction: 'pan-y' },
              onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
                if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
                scrub(e);
              },
              onPointerMove: scrub,
              onPointerUp: () => setActive(null),
              onPointerCancel: () => setActive(null),
              onPointerLeave: () => setActive(null),
            }
          : {})}
      >
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
        {active !== null && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 h-full w-px bg-ink-faint"
              style={{ left: `${(x(at) / W) * 100}%` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sage-700 ring-2 ring-surface"
              style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(shown.p50) / H) * 100}%` }}
            />
          </>
        )}
      </div>
      <figcaption aria-live="polite" className="mt-2 type-caption text-ink-muted money">
        <span className="block text-center">Age {shown.age}</span>
        <span className="mt-1 flex justify-between">
          <span>Bad market: {formatCents(shown.p10, { whole: true })}</span>
          <span>Typical: {formatCents(shown.p50, { whole: true })}</span>
          <span>Good market: {formatCents(shown.p90, { whole: true })}</span>
        </span>
      </figcaption>
    </figure>
  );
}
