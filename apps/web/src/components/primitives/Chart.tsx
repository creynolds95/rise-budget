import {
  RANGES,
  lineSegments,
  sharedScalePaths,
  zeroY,
  type LinePoint,
  type Range,
} from '../../lib/chart';
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
    | { kind: 'bar'; bars: Bar[] }
    | { kind: 'lines'; lines: Line[]; slots: number; xLabels: string[] }
  ) & { label: string; range?: Range; onRange?: (r: Range) => void },
) {
  const zeroAt = props.kind === 'line' ? zeroY(props.points, H) : null;
  return (
    <figure className="m-0">
      <div className="relative">
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
          {props.kind === 'lines' && lines(props.lines, props.slots)}
          {props.kind === 'line' && zeroAt !== null && (
            <line
              x1={0}
              x2={W}
              y1={zeroAt}
              y2={zeroAt}
              className="stroke-ink-faint"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {props.kind === 'line' &&
            lineSegments(props.points, W, H).map((s, i) => (
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
            ))}
          {props.kind === 'bar' && bars(props.bars)}
        </svg>
        {/* Plain HTML, not SVG text: the svg above stretches non-uniformly
            (preserveAspectRatio="none"), which would distort glyphs. Height scale is 1:1
            (the box is always h-40 = H), so a top percentage lines up with the svg's y. */}
        {zeroAt !== null && (
          <span
            aria-hidden
            className="type-caption absolute left-0 -translate-y-1/2 bg-surface pr-1 text-ink-faint"
            style={{ top: `${(zeroAt / H) * 100}%` }}
          >
            $0
          </span>
        )}
      </div>
      {props.kind === 'lines' && <Axis labels={props.xLabels} spread />}
      {props.kind === 'bar' && props.bars.length > 0 && (
        <Axis labels={props.bars.map((b) => b.label)} />
      )}
      {props.range && props.onRange && <RangeChips value={props.range} onChange={props.onRange} />}
    </figure>
  );
}

/** A bar; `muted` marks one that isn't final yet, like the month in progress. */
export interface Bar {
  label: string;
  cents: number;
  muted?: boolean;
}

/** One series of a shared-scale line chart; `color` is a `series` entry (§7). */
export interface Line {
  label: string;
  values: number[];
  color: string;
  /** Ends in a dot: the series that is still being written, e.g. this month. */
  live?: boolean;
}

function Axis({ labels, spread = false }: { labels: string[]; spread?: boolean }) {
  return (
    <div
      aria-hidden
      className={`mt-1 flex type-caption text-ink-faint ${spread ? 'justify-between' : ''}`}
    >
      {labels.map((l, i) => (
        <span key={`${l}-${i}`} className={spread ? '' : 'flex-1 text-center'}>
          {l}
        </span>
      ))}
    </div>
  );
}

function lines(data: Line[], slots: number) {
  const paths = sharedScalePaths(
    data.map((l) => l.values),
    slots,
    W,
    H,
  );
  return data.map((l, i) => {
    const p = paths[i] as (typeof paths)[number];
    return (
      <g key={l.label}>
        <polyline
          points={p.points.map((xy) => xy.join(',')).join(' ')}
          fill="none"
          stroke={l.color}
          strokeWidth={l.live ? 2.5 : 1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {l.live && p.last && (
          // A circle would stretch with preserveAspectRatio="none"; a zero-length round-capped
          // line stays round because its stroke doesn't scale.
          <line
            x1={p.last[0]}
            y1={p.last[1]}
            x2={p.last[0]}
            y2={p.last[1]}
            stroke={l.color}
            strokeWidth={8}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    );
  });
}

function bars(data: Bar[]) {
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
        fill={d.muted ? series[3] : series[0]}
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
