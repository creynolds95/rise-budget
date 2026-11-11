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
  return (
    <Sheet
      open={open}
      title="Accounts to show"
      onClose={onClose}
      action={{
        label: 'Save',
        onClick: () => {
          patch.mutate(ids);
          onClose();
        },
      }}
    >
      <ul className="divide-y divide-hairline rounded-card bg-surface shadow-soft">
        {open_.map((a) => (
          <li key={a.id} className="flex min-h-13 items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate">{a.name}</span>
            <Toggle
              label={a.name}
              on={ids.length === 0 || ids.includes(a.id)}
              onChange={(on) =>
                setIds((prev) => {
                  const cur = prev.length === 0 ? open_.map((x) => x.id) : prev;
                  const next = on ? [...cur, a.id] : cur.filter((id) => id !== a.id);
                  // Every account on is the same as none picked.
                  return next.length === open_.length ? [] : next;
                })
              }
            />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
