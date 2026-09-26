import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CategoryPicker } from '../components/CategoryPicker';
import { FilterSheet } from '../components/FilterSheet';
import { TxnAmount } from '../components/TxnAmount';
import { TxnRow } from '../components/TxnRow';
import { Button } from '../components/primitives/Button';
import { Icon, IconButton } from '../components/primitives/Icon';
import { Skeleton } from '../components/primitives/Skeleton';
import { api } from '../lib/api';
import { shortDate } from '../lib/dates';
import { useHeaderActions } from '../lib/headerActions';
import { useIsDesktop } from '../lib/media';
import { merchantName } from '../lib/merchant';
import { transitionClick } from '../lib/transition';
import {
  useAccounts,
  useCategories,
  useGroups,
  useInvalidateMoney,
  useToday,
  useTransactions,
} from '../lib/queries';
import {
  apiQuery,
  chips,
  dayLabel,
  filtersToParams,
  groupByDay,
  parseFilters,
  type Filters,
} from '../lib/txnFilters';

/** The Transactions tab: everything, searchable, filterable. Filters live in the URL. */
export function Transactions() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const groups = useGroups().data ?? [];
  const filters = parseFilters(params);
  const [q, setQ] = useState(filters.q);
  const [sheet, setSheet] = useState(false);
  const [recategorizing, setRecategorizing] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const apply = (f: Filters) => setParams(filtersToParams(f), { replace: true });

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const h = setTimeout(() => {
      if (q.trim() !== filters.q) apply({ ...parseFilters(params), q: q.trim() });
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const list = useTransactions(apiQuery(filters, today));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const cat = (id: string | undefined) => categories.find((c) => c.id === id);
  const active = chips(filters, {
    account: (id) => accounts.find((a) => a.id === id)?.name ?? 'Account',
    category: (id) => cat(id)?.name ?? 'Category',
  });
  const back = `Transactions|/transactions${params.size ? `?${params}` : ''}`;
  const byDate = filters.sort.startsWith('date');
  const batchReview = filters.review === 'needs_review';

  const afterChange = () =>
    Promise.all([
      invalidate(),
      qc.invalidateQueries({ queryKey: ['queue-count'] }),
      qc.invalidateQueries({ queryKey: ['review-queue'] }),
    ]);

  const markAllReviewed = async () => {
    setMarking(true);
    try {
      await Promise.all(
        items.map((t) => api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' })),
      );
      await afterChange();
    } finally {
      setMarking(false);
    }
  };

  const row = (t: (typeof items)[number]) => {
    const c = t.splits.length === 1 ? cat(t.splits[0]?.categoryId) : undefined;
    return (
      <TxnRow
        key={t.id}
        t={t}
        categoryName={c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : undefined}
        from={back}
        hideDate={byDate}
        onRecategorize={batchReview ? () => setRecategorizing(t.id) : undefined}
      />
    );
  };

  // Desktop: one scannable table, category editable in place (C14).
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const table = (
    <table className="w-full overflow-hidden rounded-card bg-surface shadow-soft">
      <thead>
        <tr className="border-b border-hairline text-left type-label text-ink-muted">
          <th className="px-4 py-2 font-normal">Date</th>
          <th className="px-4 py-2 font-normal">Merchant</th>
          <th className="px-4 py-2 font-normal">Category</th>
          <th className="px-4 py-2 font-normal">Account</th>
          <th className="px-4 py-2 text-right font-normal">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => {
          const c = t.splits.length === 1 ? cat(t.splits[0]?.categoryId) : undefined;
          const to = `/transactions/${t.id}?from=${encodeURIComponent(back)}`;
          return (
            <tr
              key={t.id}
              onClick={transitionClick(navigate, to)}
              className={`cursor-pointer border-b border-hairline last:border-0 hover:bg-sage-100/50 ${t.isPending ? 'italic' : ''}`}
            >
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-muted money">
                {shortDate(t.postedAt)}
              </td>
              <td className="max-w-72 truncate px-4 py-2.5">
                {merchantName(t)}
                {t.isPending && (
                  <span
                    className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
                    title="Pending"
                  >
                    P
                  </span>
                )}
                {t.reviewState === 'needs_review' && (
                  <span className="ml-2 type-caption text-ink-faint not-italic">To review</span>
                )}
              </td>
              <td className="px-4 py-1.5">
                {t.isTransfer || t.splits.length > 1 ? (
                  <span className="text-ink-muted">{t.isTransfer ? 'Transfer' : 'Split'}</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecategorizing(t.id);
                    }}
                    className="min-h-9 max-w-56 truncate rounded-full px-3 text-left hover:bg-sage-100"
                  >
                    {c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : 'Uncategorized'}
                  </button>
                )}
              </td>
              <td className="max-w-48 truncate px-4 py-2.5 text-ink-muted">
                {accounts.find((a) => a.id === t.accountId)?.name}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                <TxnAmount t={t} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const filterButton = (
    <IconButton
      icon="filter"
      label={active.length ? `Filters, ${active.length} on` : 'Filters'}
      badge={active.length}
      onClick={() => setSheet(true)}
    />
  );
  useHeaderActions(filterButton);

  return (
    <div className={`mx-auto pb-12 ${desktop ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <header className="gutter hidden items-center justify-between pt-3 lg:flex">
        <h1 className="type-page">Transactions</h1>
        <div className="-mr-2">{filterButton}</div>
      </header>

      <div className="gutter mt-2">
        <label className="flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 shadow-soft focus-within:ring-2 focus-within:ring-sage-600">
          <span className="text-ink-faint">
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              className="fill-none stroke-current"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            aria-label="Search transactions"
            className="min-h-11 min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Search merchants, notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:px-6">
          {active.map((c) => (
            <button
              key={c.key}
              onClick={() => apply(c.clear(filters))}
              aria-label={`Remove filter: ${c.label}`}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-sage-100 pr-2.5 pl-3.5 type-caption font-medium text-sage-700 active:bg-sage-300"
            >
              {c.label}
              <svg
                aria-hidden
                width="10"
                height="10"
                viewBox="0 0 14 14"
                className="stroke-current"
              >
                <path d="M1 1l12 12M13 1L1 13" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ))}
          {active.length > 1 && (
            <button
              onClick={() => apply({ ...parseFilters(new URLSearchParams()), q: filters.q })}
              className="min-h-9 shrink-0 px-2 type-caption font-medium text-ink-muted"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {batchReview && items.length > 0 && (
        <div className="gutter mt-3">
          <Button className="w-full" onClick={() => void markAllReviewed()} disabled={marking}>
            {marking ? 'Marking…' : `Mark all reviewed (${items.length})`}
          </Button>
        </div>
      )}

      <div className="gutter mt-3">
        {list.isPending &&
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="mb-2 h-12 w-full" />)}
        {list.data && items.length === 0 && (
          <div className="py-12 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sage-100 text-sage-700">
              <Icon name={active.length || filters.q ? 'filter' : 'wallet'} />
            </span>
            <p className="mt-3 font-medium">
              {active.length || filters.q ? 'Nothing matches' : 'No transactions yet'}
            </p>
            <p className="mt-1 text-ink-muted">
              {active.length || filters.q
                ? 'Try a wider date range or fewer filters.'
                : 'They arrive with the first bank sync.'}
            </p>
            {(active.length > 0 || filters.q) && (
              <Button
                variant="quiet"
                className="mt-2"
                onClick={() => {
                  setQ('');
                  apply(parseFilters(new URLSearchParams()));
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
        {desktop && items.length > 0 ? (
          table
        ) : byDate ? (
          groupByDay(items).map(([day, rows]) => (
            <section key={day}>
              <h2 className="sticky top-[var(--banner-h,0px)] z-[1] -mx-4 bg-canvas/95 px-4 pt-4 pb-1 type-label text-ink-muted backdrop-blur md:-mx-6 md:px-6">
                {dayLabel(day, today)}
              </h2>
              <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
                {rows.map(row)}
              </div>
            </section>
          ))
        ) : (
          <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {items.map(row)}
          </div>
        )}
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

      <FilterSheet
        open={sheet}
        value={filters}
        accounts={accounts}
        categories={categories}
        groups={groups}
        onClose={() => setSheet(false)}
        onApply={(f) => {
          apply({ ...f, q: q.trim() });
          setSheet(false);
        }}
      />

      <CategoryPicker
        open={recategorizing !== null}
        onClose={() => setRecategorizing(null)}
        onPick={(categoryId) => {
          const id = recategorizing;
          setRecategorizing(null);
          if (!id) return;
          void api('PATCH', `/transactions/${id}`, { categoryId, reviewState: 'reviewed' }).then(
            afterChange,
          );
        }}
      />
    </div>
  );
}
