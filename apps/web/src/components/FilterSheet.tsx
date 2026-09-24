import type { Account, Category, CategoryGroup } from '@rise/shared/schemas';
import { useState, type ReactNode } from 'react';
import { KIND_GROUPS } from '../routes/Accounts';
import { centsToInput, parseMoney } from '../lib/money';
import {
  DATE_PRESETS,
  EMPTY,
  SORTS,
  type Direction,
  type Filters,
  type ReviewFilter,
} from '../lib/txnFilters';
import { Button } from './primitives/Button';
import { Group, RadioRow } from './primitives/Group';
import { Icon } from './primitives/Icon';
import { Chevron } from './primitives/Rows';
import { Sheet } from './primitives/Sheet';

type Page = 'root' | 'accounts' | 'categories' | 'amount' | 'review';

/**
 * Monarch-style filters: date, sort, then a list of things to narrow by, each opening its own
 * page inside the sheet. Nothing applies until Apply, so exploring is free.
 */
export function FilterSheet({
  open,
  value,
  accounts,
  categories,
  groups,
  onApply,
  onClose,
}: {
  open: boolean;
  value: Filters;
  accounts: Account[];
  categories: Category[];
  groups: CategoryGroup[];
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Inner
      value={value}
      accounts={accounts}
      categories={categories}
      groups={groups}
      onApply={onApply}
      onClose={onClose}
    />
  );
}

function Inner({
  value,
  accounts,
  categories,
  groups,
  onApply,
  onClose,
}: {
  value: Filters;
  accounts: Account[];
  categories: Category[];
  groups: CategoryGroup[];
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Filters>(value);
  const [page, setPage] = useState<Page>('root');
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch });
  const live = accounts.filter((a) => !a.archivedAt);
  const TITLES: Record<Page, string> = {
    root: 'Filters',
    accounts: 'Accounts',
    categories: 'Categories',
    amount: 'Amount',
    review: 'Review status',
  };
  const summary = (ids: string[], total: number, name: (id: string) => string | undefined) =>
    ids.length === 0
      ? 'All'
      : ids.length === 1
        ? (name(ids[0] as string) ?? '1')
        : `${ids.length} of ${total}`;

  return (
    <Sheet open title={TITLES[page]} onClose={onClose}>
      {page !== 'root' && (
        <button
          onClick={() => setPage('root')}
          className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sage-700"
        >
          <span aria-hidden>‹</span> Filters
        </button>
      )}

      {page === 'root' && (
        <>
          <Group title="Date range">
            <div className="flex flex-wrap gap-2 p-3">
              {DATE_PRESETS.map((d) => (
                <Pill key={d.id} on={f.range === d.id} onClick={() => set({ range: d.id })}>
                  {d.label}
                </Pill>
              ))}
            </div>
            {f.range === 'custom' && (
              <div className="grid grid-cols-2 gap-3 p-3">
                <label className="flex flex-col gap-1">
                  <span className="type-caption text-ink-muted">From</span>
                  <input
                    type="date"
                    value={f.from}
                    max={f.to || undefined}
                    onChange={(e) => set({ from: e.target.value })}
                    className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="type-caption text-ink-muted">To</span>
                  <input
                    type="date"
                    value={f.to}
                    min={f.from || undefined}
                    onChange={(e) => set({ to: e.target.value })}
                    className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
                  />
                </label>
              </div>
            )}
          </Group>

          <Group title="Sort by">
            <label className="flex min-h-13 items-center justify-between gap-4 px-4">
              <span className="sr-only">Sort by</span>
              <span className="relative flex w-full items-center">
                <select
                  value={f.sort}
                  onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}
                  className="min-h-13 w-full appearance-none bg-transparent pr-8 outline-none"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-0 text-ink-muted">
                  <Icon name="chevronDown" size={18} />
                </span>
              </span>
            </label>
          </Group>

          <Group title="Filter by">
            <DrillRow
              label="Accounts"
              value={summary(f.accounts, live.length, (id) => live.find((a) => a.id === id)?.name)}
              onClick={() => setPage('accounts')}
            />
            <DrillRow
              label="Categories"
              value={summary(
                f.categories,
                categories.length,
                (id) => categories.find((c) => c.id === id)?.name,
              )}
              onClick={() => setPage('categories')}
            />
            <DrillRow
              label="Amount"
              value={
                f.direction === 'any' && f.minCents === null && f.maxCents === null ? 'Any' : 'Set'
              }
              onClick={() => setPage('amount')}
            />
            <DrillRow
              label="Review status"
              value={
                {
                  any: 'Any',
                  needs_review: 'To review',
                  reviewed: 'Reviewed',
                  dropped: 'Never posted',
                }[f.review]
              }
              onClick={() => setPage('review')}
            />
          </Group>
        </>
      )}

      {page === 'accounts' && (
        <CheckList
          groups={KIND_GROUPS.map((k) => ({
            title: k.label,
            items: live.filter((a) => a.kind === k.kind).map((a) => ({ id: a.id, label: a.name })),
          }))}
          selected={f.accounts}
          onChange={(accounts) => set({ accounts })}
        />
      )}

      {page === 'categories' && (
        <CheckList
          groups={groups.map((g) => ({
            title: g.name,
            items: categories
              .filter((c) => c.groupId === g.id)
              .map((c) => ({ id: c.id, label: `${c.emoji ? `${c.emoji}  ` : ''}${c.name}` })),
          }))}
          selected={f.categories}
          onChange={(categories) => set({ categories })}
        />
      )}

      {page === 'amount' && <AmountPage f={f} set={set} />}

      {page === 'review' && (
        <Group>
          {(
            [
              ['any', 'Any'],
              ['needs_review', 'To review'],
              ['reviewed', 'Reviewed'],
              ['dropped', 'Never posted'],
            ] as [ReviewFilter, string][]
          ).map(([id, label]) => (
            <RadioRow
              key={id}
              name="review"
              label={label}
              checked={f.review === id}
              onSelect={() => set({ review: id })}
            />
          ))}
        </Group>
      )}

      <div className="sticky bottom-0 -mx-4 mt-6 flex gap-3 bg-canvas px-4 pt-2 md:-mx-6 md:px-6">
        <Button
          variant="quiet"
          className="flex-1 border border-hairline bg-surface"
          onClick={() => setF({ ...EMPTY, q: f.q })}
        >
          Clear all
        </Button>
        <Button className="flex-1" onClick={() => onApply(f)}>
          Apply
        </Button>
      </div>
    </Sheet>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-9 rounded-full px-3.5 type-caption font-medium ${
        on ? 'bg-sage-700 text-surface' : 'bg-canvas text-ink ring-1 ring-hairline'
      }`}
    >
      {children}
    </button>
  );
}

function DrillRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-13 w-full items-center justify-between gap-4 px-4 py-3 text-left active:bg-sage-100"
    >
      <span>{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-ink-muted">
        <span className="truncate">{value}</span>
        <Chevron />
      </span>
    </button>
  );
}

function CheckList({
  groups,
  selected,
  onChange,
}: {
  groups: { title: string; items: { id: string; label: string }[] }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const sel = new Set(selected);
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  const visible = groups.filter((g) => g.items.length > 0);
  return (
    <>
      <p className="px-1 type-caption text-ink-muted">
        {selected.length === 0
          ? 'Showing all. Pick any to narrow it down.'
          : `${selected.length} selected`}
        {selected.length > 0 && (
          <button className="ml-2 font-medium text-sage-700" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </p>
      {visible.map((g) => (
        <Group key={g.title} title={g.title}>
          {g.items.map((it) => (
            <label
              key={it.id}
              className="flex min-h-13 cursor-pointer items-center justify-between gap-4 px-4 py-3 active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{it.label}</span>
              <input
                type="checkbox"
                className="sr-only"
                checked={sel.has(it.id)}
                onChange={() => toggle(it.id)}
              />
              <span
                aria-hidden
                className={`flex size-6 shrink-0 items-center justify-center rounded-[7px] border-2 ${
                  sel.has(it.id) ? 'border-sage-600 bg-sage-600 text-surface' : 'border-hairline'
                }`}
              >
                {sel.has(it.id) && <Icon name="check" size={16} />}
              </span>
            </label>
          ))}
        </Group>
      ))}
      {visible.length === 0 && <p className="mt-4 text-ink-muted">Nothing here yet.</p>}
    </>
  );
}

function AmountPage({ f, set }: { f: Filters; set: (p: Partial<Filters>) => void }) {
  const [min, setMin] = useState(f.minCents === null ? '' : centsToInput(f.minCents));
  const [max, setMax] = useState(f.maxCents === null ? '' : centsToInput(f.maxCents));
  const commit = (text: string, key: 'minCents' | 'maxCents') => {
    const c = text.trim() ? parseMoney(text) : null;
    set({ [key]: c === null || c < 0 ? null : c });
  };
  const input = 'min-h-11 w-full rounded-input border border-hairline bg-canvas px-3 money';
  return (
    <>
      <Group title="Direction">
        {(
          [
            ['any', 'Any'],
            ['out', 'Spending'],
            ['in', 'Money in'],
          ] as [Direction, string][]
        ).map(([id, label]) => (
          <RadioRow
            key={id}
            name="direction"
            label={label}
            checked={f.direction === id}
            onSelect={() => set({ direction: id })}
          />
        ))}
      </Group>
      <Group title="Size" footer="Either way the money went. Leave a side blank for no limit.">
        <div className="grid grid-cols-2 gap-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="type-caption text-ink-muted">At least</span>
            <input
              inputMode="decimal"
              placeholder="$0"
              className={input}
              value={min}
              onChange={(e) => {
                setMin(e.target.value);
                commit(e.target.value, 'minCents');
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-caption text-ink-muted">At most</span>
            <input
              inputMode="decimal"
              placeholder="No limit"
              className={input}
              value={max}
              onChange={(e) => {
                setMax(e.target.value);
                commit(e.target.value, 'maxCents');
              }}
            />
          </label>
        </div>
      </Group>
    </>
  );
}
