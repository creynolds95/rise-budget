import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DashboardTile } from '@rise/shared/schemas';
import { api } from '../lib/api';
import { TILE_LABELS, tileOrder } from '../lib/dashboard';
import { useMe } from '../lib/queries';
import { Sheet } from './primitives/Sheet';
import { Sortable } from './primitives/Sortable';
import { Toggle } from './primitives/Toggle';

/** Six dots: the handle to pick a row up by. */
function Grip() {
  return (
    <svg aria-hidden width="14" height="20" viewBox="0 0 14 20" className="fill-current">
      {[3, 10, 17].flatMap((y) =>
        [3, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />),
      )}
    </svg>
  );
}

/** Show, hide and reorder the Dashboard's tiles. Every change saves as it's made. */
export function CustomizeDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (dashboard: DashboardTile[]) => api('PATCH', '/me/settings', { dashboard }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const { all, shown } = tileOrder(me?.settings.dashboard ?? null);
  const commit = (order: readonly DashboardTile[], on: ReadonlySet<DashboardTile>) =>
    save.mutate(order.filter((t) => on.has(t)));
  return (
    <Sheet open={open} title="Customize dashboard" onClose={onClose}>
      <Sortable
        items={all.map((id) => ({ id }))}
        onReorder={(ids) => commit(ids as DashboardTile[], shown)}
        className="list-none overflow-hidden rounded-card bg-surface shadow-soft"
      >
        {({ id }, grip) => {
          const tile = id as DashboardTile;
          return (
            <div className="flex min-h-14 items-center border-b border-hairline pr-4 last:border-b-0">
              <span
                {...(grip as object)}
                role="button"
                aria-label={`Drag ${TILE_LABELS[tile]} to reorder`}
                className="flex size-11 shrink-0 items-center justify-center text-ink-faint"
              >
                <Grip />
              </span>
              <span className="min-w-0 flex-1 truncate">{TILE_LABELS[tile]}</span>
              <Toggle
                label={TILE_LABELS[tile]}
                on={shown.has(tile)}
                onChange={(on) =>
                  commit(all, new Set(on ? [...shown, tile] : [...shown].filter((t) => t !== tile)))
                }
              />
            </div>
          );
        }}
      </Sortable>
    </Sheet>
  );
}
