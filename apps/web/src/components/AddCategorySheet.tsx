import type { CategoryGroup } from '@rise/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Button } from './primitives/Button';
import { Sheet } from './primitives/Sheet';

/** Rise ships no categories; this is how the first ones get made. */
export function AddCategorySheet({
  open,
  groups,
  onClose,
}: {
  open: boolean;
  groups: CategoryGroup[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const expense = groups.filter((g) => g.kind === 'expense');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [newGroup, setNewGroup] = useState('');
  const [isBill, setIsBill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingGroup = expense.length === 0 || groupId === 'new';

  const submit = async () => {
    setError(null);
    try {
      let gid = groupId;
      if (creatingGroup) {
        gid = (
          await api<CategoryGroup>('POST', '/category-groups', {
            name: newGroup.trim(),
            kind: 'expense',
          })
        ).id;
      }
      await api('POST', '/categories', {
        groupId: gid || expense[0]?.id,
        name: name.trim(),
        isBill,
      });
      await Promise.all(
        ['groups', 'categories', 'period'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
      setName('');
      setNewGroup('');
      setIsBill(false);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    }
  };

  const field = 'min-h-11 w-full rounded-input border border-hairline bg-surface px-3';
  return (
    <Sheet open={open} title="New category" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="type-label text-ink-muted">Name</span>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Groceries"
            required
          />
        </label>
        {expense.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="type-label text-ink-muted">Group</span>
            <select
              className={field}
              value={groupId || expense[0]?.id}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {expense.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="new">New group…</option>
            </select>
          </label>
        )}
        {creatingGroup && (
          <label className="flex flex-col gap-1">
            <span className="type-label text-ink-muted">New group</span>
            <input
              className={field}
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Everyday"
              required
            />
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-sage-600"
            checked={isBill}
            onChange={(e) => setIsBill(e.target.checked)}
          />
          <span>
            A bill
            <span className="block type-caption text-ink-faint">
              Paid once a month. Leftover goes back to the pool instead of carrying.
            </span>
          </span>
        </label>
        {error && <p className="text-clay">{error}</p>}
        <Button type="submit">Add category</Button>
      </form>
    </Sheet>
  );
}
