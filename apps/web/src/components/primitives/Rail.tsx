import { formatCents } from '../../lib/money';
import { railGeometry, type RailInput } from '../../lib/rail';

/** The signature component (DESIGN-SYSTEM.md §6). Not a progress bar. */
export function Rail(props: RailInput & { availableCents: number }) {
  const g = railGeometry(props);
  const at = (s: { start: number; width: number }) => ({
    left: `${s.start}%`,
    width: `${s.width}%`,
  });
  const label =
    `${props.carriedInCents !== 0 ? `Carried ${formatCents(props.carriedInCents)}, ` : ''}` +
    `${formatCents(props.plannedCents)} planned, ${formatCents(props.spentCents)} spent of ` +
    `${formatCents(props.availableCents)} available` +
    (g.over ? ', over budget' : '');
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-2 w-full overflow-visible rounded-full bg-canvas"
    >
      {g.carried && (
        <span
          data-seg="carried"
          className={`absolute inset-y-0 rounded-l-full ${g.carried.tone === 'deficit' ? 'bg-clay-100' : 'bg-sage-100'}`}
          style={at(g.carried)}
        />
      )}
      <span
        data-seg="allocated"
        className="absolute inset-y-0 bg-sage-100"
        style={at(g.allocated)}
      />
      <span data-seg="spent" className="absolute inset-y-0 bg-sage-600" style={at(g.spent)} />
      {g.over && (
        <span
          data-seg="over"
          className="absolute inset-y-0 rounded-r-full bg-clay"
          style={at(g.over)}
        />
      )}
      {g.tick !== null && (
        <span
          data-seg="tick"
          aria-hidden
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${g.tick}%` }}
        />
      )}
    </div>
  );
}
