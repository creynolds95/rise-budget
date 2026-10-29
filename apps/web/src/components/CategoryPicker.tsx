import { useState } from 'react';
import { useCategories, useGroups } from '../lib/queries';
import { Sheet } from './primitives/Sheet';
import { Toggle } from './primitives/Toggle';

/** Every category, grouped, with a filter. The swipe-left and "Other…" target (SPEC §8). */
export function CategoryPicker({
  open,
  title = 'Choose a category',
  always,
  onPick,
  onClose,
}: {
  open: boolean;
  title?: string;
  /** Offer "Always file this merchant here"; the pick then says whether it was on. */
  always?: { merchant: string } | undefined;
  onPick: (categoryId: string, always: boolean) => void;
  onClose: () => void;
}) {
  const groups = useGroups().data ?? [];
  const categories = useCategories().data ?? [];
  const [q, setQ] = useState('');
  const [rule, setRule] = useState(false);
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <Sheet
      open={open}
      title={title}
      onClose={() => {
        setQ('');
        setRule(false);
        onClose();
      }}
    >
      {always && (
        <div className="mb-3 flex min-h-12 items-center justify-between gap-3 rounded-card bg-surface px-4 shadow-soft">
          <span className="min-w-0 truncate">Always file {always.merchant} here</span>
          <Toggle label="Always file this merchant here" on={rule} onChange={setRule} />
        </div>
      )}
      {/* No autofocus: the keyboard rising mid-slide makes the sheet stutter and, on iOS,
          can leave the page's height short afterwards. Tap Search to type. */}
      <input
        aria-label="Filter categories"
        className="min-h-11 w-full rounded-input border border-hairline bg-surface px-3"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {categories.length === 0 && (
        <p className="py-4 text-ink-muted">No categories yet. Add them from the Budget tab.</p>
      )}
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && match(c.name));
        if (cats.length === 0) return null;
        return (
          <section key={g.id} className="mt-4">
            <h3 className="type-label text-ink-muted">{g.name}</h3>
            <ul>
              {cats.map((c) => (
                <li key={c.id}>
                  <button
                    className="flex min-h-12 w-full items-center border-b border-hairline text-left active:bg-sage-100"
                    onClick={() => {
                      setQ('');
                      onPick(c.id, rule);
                      setRule(false);
                    }}
                  >
                    {c.emoji && <span className="mr-2">{c.emoji}</span>}
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Sheet>
  );
}
