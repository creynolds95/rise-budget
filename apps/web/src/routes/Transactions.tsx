import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { TxnRow } from '../components/TxnRow';
import { Button } from '../components/primitives/Button';
import { Skeleton } from '../components/primitives/Skeleton';
import { useAccounts, useCategories, useTransactions, type TxnFilters } from '../lib/queries';

/** The Transactions tab: everything, searchable, filterable. Filters live in the URL. */
export function Transactions() {
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );
  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const h = setTimeout(() => set('q', q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);

  const filters: TxnFilters = {};
  for (const k of ['q', 'account', 'category', 'from', 'to'] as const) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  const state = params.get('reviewState');
  if (state === 'needs_review' || state === 'reviewed' || state === 'dropped')
    filters.reviewState = state;
  const list = useTransactions(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const catName = (id: string | undefined) =>
    id ? categories.find((c) => c.id === id)?.name : undefined;
  const select =
    'min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-surface px-2 type-caption';
  const back = `Transactions|/transactions${params.size ? `?${params}` : ''}`;

  return (
    <div className="gutter mx-auto max-w-2xl pt-4 pb-12">
      <h1 className="type-title">Transactions</h1>
      <input
        type="search"
        aria-label="Search transactions"
        className="mt-3 min-h-11 w-full rounded-input border border-hairline bg-surface px-3"
        placeholder="Search merchant, description, notes"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <select
          aria-label="Account"
          className={select}
          value={params.get('account') ?? ''}
          onChange={(e) => set('account', e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Category"
          className={select}
          value={params.get('category') ?? ''}
          onChange={(e) => set('category', e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Review state"
          className={select}
          value={state ?? ''}
          onChange={(e) => set('reviewState', e.target.value)}
        >
          <option value="">Any state</option>
          <option value="needs_review">To review</option>
          <option value="reviewed">Reviewed</option>
          <option value="dropped">Never posted</option>
        </select>
      </div>

      <div className="mt-4">
        {list.isPending &&
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="mb-2 h-12 w-full" />)}
        {list.data && items.length === 0 && (
          <p className="py-8 text-center text-ink-muted">
            {params.size
              ? 'Nothing matches.'
              : 'No transactions yet. They arrive with the first sync.'}
          </p>
        )}
        {items.map((t) => (
          <TxnRow
            key={t.id}
            t={t}
            categoryName={t.splits.length === 1 ? catName(t.splits[0]?.categoryId) : undefined}
            from={back}
          />
        ))}
        {list.hasNextPage && (
          <Button
            variant="quiet"
            className="mt-2 w-full"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </Button>
        )}
      </div>
    </div>
  );
}
