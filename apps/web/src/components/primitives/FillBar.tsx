import type { Pace } from '@rise/shared/budget';

/**
 * A single-fill progress bar: the Summary tile's Income/Expenses rows and an income
 * category's row. Unlike `Rail` (DESIGN-SYSTEM.md §6), there's no carried segment and no
 * clay-over tint by default — earning more than planned is good, not overspending, so a
 * caller opts into the clay tint with `over` only where going past the target is bad
 * (expenses), never for income.
 */
export function FillBar({
  filledCents,
  targetCents,
  tick,
  over = false,
}: {
  filledCents: number;
  targetCents: number;
  tick: Pace | null;
  over?: boolean;
}) {
  const pct =
    targetCents > 0 ? Math.min(100, (filledCents / targetCents) * 100) : filledCents > 0 ? 100 : 0;
  const tickPct =
    tick && tick.totalDays > 0 ? Math.min(100, (tick.elapsedDays / tick.totalDays) * 100) : null;
  return (
    <div role="img" aria-hidden className="relative h-2 w-full overflow-visible rounded-full bg-hairline">
      <span
        data-seg="fill"
        className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-clay' : 'bg-sage-600'}`}
        style={{ width: `${pct}%` }}
      />
      {tickPct !== null && (
        <span
          data-seg="tick"
          aria-hidden
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${tickPct}%` }}
        />
      )}
    </div>
  );
}
