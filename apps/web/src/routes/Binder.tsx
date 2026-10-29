import type { Binder as BinderData, BinderEntry } from '@rise/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loading } from '../components/Pending';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { IconButton } from '../components/primitives/Icon';
import { EditRow, ValueRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { api } from '../lib/api';
import { BINDER_KINDS, binderSections, blankEntry } from '../lib/binder';
import { useAccounts, useMe } from '../lib/queries';

const EMPTY: BinderData = { passwordsLiveIn: '', entries: [] };

/**
 * The household binder (SPEC §12.2): who to call and where things are, for whoever has to
 * step in. Never passwords; only where they live.
 */
export function Binder() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (binder: BinderData) => api('PATCH', '/me/settings', { binder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const [editing, setEditing] = useState<BinderEntry | null>(null);
  const [passwords, setPasswords] = useState(false);
  const header = {
    back: { label: 'Financial health', to: '/financial-health' },
    title: 'Household binder',
  };
  if (!me || !accounts) {
    return (
      <DetailPage
        header={header}
        facts={
          <Loading>
            <Skeleton className="my-4 h-24 w-full" />
          </Loading>
        }
      />
    );
  }
  const binder = me.settings.binder ?? EMPTY;
  const sections = binderSections(binder, accounts);
  const put = (entry: BinderEntry) => {
    const rest = binder.entries.filter((e) => e.id !== entry.id);
    save.mutate({ ...binder, entries: [...rest, entry] });
  };
  const remove = (id: string) =>
    save.mutate({ ...binder, entries: binder.entries.filter((e) => e.id !== id) });

  return (
    <>
      <DetailPage
        header={{
          ...header,
          action: (
            <IconButton
              icon="plus"
              label="Add to binder"
              onClick={() => setEditing(blankEntry('other'))}
            />
          ),
        }}
        facts={
          <ValueRow label="Passwords live in" onClick={() => setPasswords(true)}>
            {binder.passwordsLiveIn || 'Add where'}
          </ValueRow>
        }
        related={sections
          .filter((s) => s.rows.length > 0)
          .map((s) => ({
            title: s.title,
            children: s.rows.map((r) => (
              <button
                key={r.entry?.id ?? r.accountId}
                type="button"
                onClick={() =>
                  setEditing(
                    r.entry ?? blankEntry('account', { id: r.accountId ?? '', name: r.title }),
                  )
                }
                className="flex min-h-12 w-full flex-col justify-center border-b border-hairline py-3 text-left last:border-b-0 active:bg-sage-100"
              >
                <span className="block truncate">{r.title}</span>
                <span className="block truncate type-caption text-ink-faint money">
                  {r.detail || 'Nothing written down yet'}
                </span>
              </button>
            )),
          }))}
      />
      {passwords && (
        <PasswordsSheet
          value={binder.passwordsLiveIn}
          onClose={() => setPasswords(false)}
          onSave={(passwordsLiveIn) => {
            save.mutate({ ...binder, passwordsLiveIn });
            setPasswords(false);
          }}
        />
      )}
      {editing && (
        <EntrySheet
          initial={editing}
          saved={binder.entries.some((e) => e.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            put(e);
            setEditing(null);
          }}
          onDelete={() => {
            remove(editing.id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'tel' | 'url' | 'numeric';
}) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-ink-faint"
    />
  );
}

function PasswordsSheet({
  value,
  onClose,
  onSave,
}: {
  value: string;
  onClose: () => void;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <Sheet
      open
      title="Passwords live in"
      onClose={onClose}
      action={{ label: 'Save', onClick: () => onSave(text.trim()) }}
    >
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Where"
          field={
            <TextField
              label="Where passwords live"
              value={text}
              onChange={setText}
              placeholder="A password manager"
            />
          }
        />
      </div>
      <p className="mt-3 type-caption text-ink-muted">Where, never the passwords themselves.</p>
    </Sheet>
  );
}

function EntrySheet({
  initial,
  saved,
  onClose,
  onSave,
  onDelete,
}: {
  initial: BinderEntry;
  saved: boolean;
  onClose: () => void;
  onSave: (e: BinderEntry) => void;
  onDelete: () => void;
}) {
  const [e, setE] = useState(initial);
  const set = (patch: Partial<BinderEntry>) => setE({ ...e, ...patch });
  const last4Ok = e.last4 === null || /^\d{4}$/.test(e.last4);
  const valid = e.title.trim().length > 0 && last4Ok;
  return (
    <Sheet
      open
      title={saved ? e.title || 'Binder' : 'Add to binder'}
      onClose={onClose}
      action={{ label: 'Save', disabled: !valid, onClick: () => onSave(e) }}
      fullScreen
    >
      {!e.accountId && (
        <div
          role="radiogroup"
          aria-label="Kind"
          className="flex flex-wrap gap-1 rounded-card bg-surface p-1"
        >
          {BINDER_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={e.kind === k.kind}
              onClick={() => set({ kind: k.kind })}
              className={`min-h-10 flex-1 rounded-input px-2 font-medium whitespace-nowrap ${
                e.kind === k.kind ? 'bg-sage-600 text-surface' : 'text-ink-muted'
              }`}
            >
              {k.title}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Name"
          field={<TextField label="Name" value={e.title} onChange={(title) => set({ title })} />}
        />
        <EditRow
          label="Last 4 digits"
          field={
            <TextField
              label="Last 4 digits"
              inputMode="numeric"
              value={e.last4 ?? ''}
              onChange={(v) => set({ last4: v.replace(/\D/g, '').slice(0, 4) || null })}
            />
          }
        />
        <EditRow
          label="Phone"
          field={
            <TextField
              label="Phone"
              inputMode="tel"
              value={e.phone}
              onChange={(phone) => set({ phone })}
            />
          }
        />
        <EditRow
          label="Website"
          field={
            <TextField
              label="Website"
              inputMode="url"
              value={e.website}
              onChange={(website) => set({ website })}
            />
          }
        />
        <EditRow
          label="Paper copy"
          field={
            <TextField
              label="Where the paper copy is"
              value={e.location}
              placeholder="Fire safe, top drawer…"
              onChange={(location) => set({ location })}
            />
          }
        />
      </div>
      <textarea
        aria-label="Notes"
        value={e.notes}
        maxLength={1000}
        rows={5}
        placeholder="Notes"
        onChange={(ev) => set({ notes: ev.target.value })}
        className="mt-2 w-full rounded-card bg-surface p-4 shadow-soft outline-none placeholder:text-ink-faint"
      />
      {!last4Ok && <p className="mt-2 text-clay">Last 4 digits only.</p>}
      {saved && (
        <Button variant="danger" className="-ml-4 mt-6" onClick={onDelete}>
          {e.accountId ? 'Clear notes' : 'Delete'}
        </Button>
      )}
    </Sheet>
  );
}
