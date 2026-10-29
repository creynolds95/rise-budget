import { series } from '../design/tokens';
import { MoneyText } from './primitives/MoneyText';

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      <span className="font-medium text-ink">{label}</span>
    </li>
  );
}

/** Interest against principal in a ring; the share on each side, the dollars beneath. */
export function Donut({ principal, interest }: { principal: number; interest: number }) {
  const total = principal + interest;
  const r = 40;
  const c = 2 * Math.PI * r;
  const share = total === 0 ? 0 : principal / total;
  const pct = (n: number) => `${Math.round((total === 0 ? 0 : n / total) * 100)}%`;
  return (
    <figure className="m-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
      <figcaption className="contents">
        <span>
          <span className="block type-title money" style={{ color: series[2] }}>
            {pct(interest)}
          </span>
          <span className="block type-caption text-ink-muted">Interest</span>
          <MoneyText cents={interest} />
        </span>
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label="Interest and principal paid this year"
          className="size-32 -rotate-90"
        >
          <circle cx={50} cy={50} r={r} fill="none" stroke={series[2]} strokeWidth={14} />
          <circle
            cx={50}
            cy={50}
            r={r}
            fill="none"
            stroke={series[0]}
            strokeWidth={14}
            strokeDasharray={`${share * c} ${c}`}
          />
        </svg>
        <span>
          <span className="block type-title money" style={{ color: series[0] }}>
            {pct(principal)}
          </span>
          <span className="block type-caption text-ink-muted">Principal</span>
          <MoneyText cents={principal} />
        </span>
      </figcaption>
    </figure>
  );
}
