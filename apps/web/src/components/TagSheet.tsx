import type { TagSummary } from '@rise/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useTags } from '../lib/queries';
import { Button } from './primitives/Button';
import { Group } from './primitives/Group';
import { Icon } from './primitives/Icon';
import { Sheet } from './primitives/Sheet';

/** Pick a transaction's tags, or make a new one on the spot. Nothing saves until Save. */
export function TagSheet({
  open,
  txnId,
  selected,
  onClose,
  onSaved,
}: {
  open: boolean;
  txnId: string;
  selected: string[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const tags = useTags().data ?? [];
  const qc = useQueryClient();
  const [sel, setSel] = useState(new Set(selected));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };
  const create = async () => {
    setError(null);
    try {
      const t = await api<TagSummary>('POST', '/tags', { name: name.trim() });
      await qc.invalidateQueries({ queryKey: ['tags'] });
      setSel(new Set([...sel, t.id]));
      setName('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the tag.');
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('PUT', `/transactions/${txnId}/tags`, { tagIds: [...sel] });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save tags.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={open}
      title="Tags"
      onClose={onClose}
      action={{ label: saving ? 'Saving…' : 'Save', onClick: () => void save(), disabled: saving }}
    >
      {tags.length > 0 && (
        <Group>
          {tags.map((t) => (
            <label
              key={t.id}
              className="flex min-h-13 cursor-pointer items-center justify-between gap-4 px-4 py-3 active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{t.name}</span>
              <input
                type="checkbox"
                className="sr-only"
                checked={sel.has(t.id)}
                onChange={() => toggle(t.id)}
              />
              <span
                aria-hidden
                className={`flex size-6 shrink-0 items-center justify-center rounded-[7px] border-2 ${
                  sel.has(t.id) ? 'border-sage-600 bg-sage-600 text-surface' : 'border-hairline'
                }`}
              >
                {sel.has(t.id) && <Icon name="check" size={16} />}
              </span>
            </label>
          ))}
        </Group>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <input
          aria-label="New tag"
          placeholder="New tag"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-surface px-3"
        />
        <Button type="submit" variant="quiet" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {error && <p className="mt-2 text-clay">{error}</p>}
    </Sheet>
  );
}
