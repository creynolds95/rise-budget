import { RANGES, lineSegments, type LinePoint, type Range } from '../../lib/chart';
import { series } from '../../design/tokens';
import { formatCents } from '../../lib/money';

const W = 320;
const H = 160;

/**
 * One chart component, one control set (§7): same height, same chip row, same axis
 * treatment for lines and bars. Hairline gridlines, no borders, no junk.
 */
export function Chart(
  props: (
    | { kind: 'line'; points: LinePoint[] }
    | { kind: 'bar'; bars: { label: string; cents: number }[] }
  ) & { label: string; range?: Range; onRange?: (r: Range) => void },
) {
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={props.label}
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
        {props.kind === 'line'
          ? lineSegments(props.points, W, H).map((s, i) => (
              <polyline
                key={i}
                data-dashed={s.dashed}
                points={s.points.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke={series[0]}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '4 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))
          : bars(props.bars)}
      </svg>
      {props.range && props.onRange && <RangeChips value={props.range} onChange={props.onRange} />}
    </figure>
  );
}

function bars(data: { label: string; cents: number }[]) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.cents)));
  const slot = W / Math.max(data.length, 1);
  return data.map((d, i) => {
    const h = (Math.abs(d.cents) / max) * (H - 8);
    return (
      <rect
        key={d.label}
        x={i * slot + slot * 0.2}
        width={slot * 0.6}
        y={H - h}
        height={h}
        rx={2}
        fill={series[0]}
      >
        <title>{`${d.label}: ${formatCents(d.cents)}`}</title>
      </rect>
    );
  });
}

export function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div role="radiogroup" aria-label="Range" className="mt-2 flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={r === value}
          onClick={() => onChange(r)}
          className={`min-h-11 flex-1 rounded-full type-caption font-medium ${
            r === value ? 'bg-sage-100 text-sage-700' : 'text-ink-muted'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
