import type { TagSummary, TaxKind } from '@rise/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/primitives/Button';
import { Group, GroupRow } from '../components/primitives/Group';
import { Icon, IconButton } from '../components/primitives/Icon';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api } from '../lib/api';
import { useInvalidateMoney, useTags } from '../lib/queries';
import { TAX_KINDS } from '../lib/tax';

/** Settings › Tags: every label, what it adds up to, and where it lands at tax time. */
export function TagsSection() {
  const tags = useTags();
  const [editing, setEditing] = useState<TagSummary | 'new' | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('settings-action')), []);
  const back = encodeURIComponent('Tags|/settings/tags');
  return (
    <>
      {slot &&
        createPortal(
          <IconButton icon="plus" label="New tag" onClick={() => setEditing('new')} />,
          slot,
        )}
      {tags.isPending && <Skeleton className="h-40 w-full" />}
      {tags.data?.length === 0 && (
        <div className="py-12 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sage-100 text-sage-700">
            <Icon name="filter" />
          </span>
          <p className="mt-3 font-medium">No tags yet</p>
          <p className="mt-1 text-ink-muted">Add one here or from any transaction.</p>
        </div>
      )}
      {tags.data && tags.data.length > 0 && (
        <ul>
          {tags.data.map((t) => (
            <li key={t.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <NavRow
                  to={`/transactions?tag=${t.id}&back=${back}`}
                  label={
                    <span className="flex flex-col">
                      <span className="truncate">{t.name}</span>
                      <span className="type-caption text-ink-faint">
                        {t.count} {t.count === 1 ? 'transaction' : 'transactions'}
                        {t.taxKind && ` · ${TAX_KINDS.find((k) => k.kind === t.taxKind)?.label}`}
                      </span>
                    </span>
                  }
                  value={
                    <MoneyText cents={Math.abs(t.netCents)} tone={t.netCents < 0 ? 'in' : 'ink'} />
                  }
                />
              </div>
              <IconButton icon="pencil" label={`Edit ${t.name}`} onClick={() => setEditing(t)} />
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TagEditSheet tag={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function TagEditSheet({ tag, onClose }: { tag: TagSummary | null; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? '');
  const [taxKind, setTaxKind] = useState<TaxKind | null>(tag?.taxKind ?? null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['tags'] })]);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() =>
      tag
        ? api('PATCH', `/tags/${tag.id}`, { name: name.trim(), taxKind })
        : api('POST', '/tags', { name: name.trim(), taxKind }),
    );
  return (
    <Sheet
      open
      title={tag ? 'Edit tag' : 'New tag'}
      onClose={onClose}
      action={{ label: 'Save', onClick: () => void save(), disabled: busy || !name.trim() }}
    >
      <Group>
        <GroupRow label="Name" htmlFor="tag-name">
          <input
            id="tag-name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-right outline-none"
          />
        </GroupRow>
        <GroupRow label="Tax heading" htmlFor="tag-tax">
          <span className="relative flex items-center text-ink-muted">
            <select
              id="tag-tax"
              value={taxKind ?? ''}
              onChange={(e) => setTaxKind((e.target.value || null) as TaxKind | null)}
              className="min-h-11 appearance-none bg-transparent pr-6 text-right text-ink outline-none [text-align-last:right]"
            >
              <option value="">None</option>
              {TAX_KINDS.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-0">
              <Icon name="chevronDown" size={18} />
            </span>
          </span>
        </GroupRow>
      </Group>
      {error && <p className="mt-3 px-1 text-clay">{error}</p>}
      {tag &&
        (confirm ? (
          <div className="mt-8 rounded-card bg-surface p-4 shadow-soft">
            <p className="font-medium">Delete {tag.name}?</p>
            <p className="mt-1 type-caption text-ink-muted">
              It comes off {tag.count} {tag.count === 1 ? 'transaction' : 'transactions'}. Their
              amounts and categories stay as they are.
            </p>
            <Button
              variant="danger"
              className="mt-3 w-full"
              disabled={busy}
              onClick={() => void run(() => api('DELETE', `/tags/${tag.id}`))}
            >
              Delete tag
            </Button>
            <Button variant="quiet" className="mt-2 w-full" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <Button
            variant="quiet"
            className="mt-8 w-full text-clay"
            onClick={() => setConfirm(true)}
          >
            Delete tag
          </Button>
        ))}
    </Sheet>
  );
}
