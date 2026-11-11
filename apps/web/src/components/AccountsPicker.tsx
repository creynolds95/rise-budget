import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAccounts } from '../lib/queries';
import { Sheet } from './primitives/Sheet';
import { Toggle } from './primitives/Toggle';

/** Choose which accounts the Dashboard's Accounts tile lists. None selected shows them all. */
export function AccountsPicker({
  open,
  onClose,
  selectedIds,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
}) {
  const accounts = useAccounts();
  const qc = useQueryClient();
  const [ids, setIds] = useState(selectedIds);
  const patch = useMutation({
    mutationFn: (dashboardAccountIds: string[]) =>
      api('PATCH', '/me/settings', { dashboardAccountIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const open_ = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const defaultIds = open_.map((a) => a.id);
  // Order matters: the tile lists accounts in this order. None picked = all, default order.
  const order = ids.length === 0 ? defaultIds : ids.filter((id) => defaultIds.includes(id));
  const byId = new Map(open_.map((a) => [a.id, a]));
  const rows = [
    ...order.flatMap((id) => byId.get(id) ?? []),
    ...open_.filter((a) => !order.includes(a.id)),
  ];
  const move = (id: string, by: -1 | 1) =>
    setIds(() => {
      const next = [...order];
      const i = next.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= next.length) return order;
      next.splice(j, 0, ...next.splice(i, 1));
      return next;
    });
  const save = () => {
    const same = order.length === defaultIds.length && order.every((id, i) => id === defaultIds[i]);
    patch.mutate(same ? [] : order);
    onClose();
  };
  return (
    <Sheet
      open={open}
      title="Accounts to show"
      onClose={onClose}
      action={{ label: 'Save', onClick: save }}
    >
      <ul className="divide-y divide-hairline rounded-card bg-surface shadow-soft">
        {rows.map((a) => {
          const on = order.includes(a.id);
          const i = order.indexOf(a.id);
          return (
            <li key={a.id} className="flex min-h-13 items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {on && (
                <span className="flex">
                  <button
                    type="button"
                    aria-label={`Move ${a.name} up`}
                    disabled={i === 0}
                    onClick={() => move(a.id, -1)}
                    className="min-h-11 min-w-11 text-ink-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${a.name} down`}
                    disabled={i === order.length - 1}
                    onClick={() => move(a.id, 1)}
                    className="min-h-11 min-w-11 text-ink-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              )}
              <Toggle
                label={a.name}
                on={on}
                onChange={(next) =>
                  setIds(() => (next ? [...order, a.id] : order.filter((id) => id !== a.id)))
                }
              />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
