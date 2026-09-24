import type { RuleOffer, Transaction } from '@rise/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { CategoryPicker } from '../components/CategoryPicker';
import { RuleOfferSheet } from '../components/RuleOfferSheet';
import { Button } from '../components/primitives/Button';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { shortDate } from '../lib/dates';
import { useAccounts, useCategories, useInvalidateMoney } from '../lib/queries';
import { confidentCount, groupQueue, type QueueItem } from '../lib/review';
import type { PatchedTransaction } from '../lib/types';

interface Queue {
  count: number;
  items: QueueItem[];
  dropped: Transaction[];
}

const FROM = 'Review|/review';
const SWIPE_PX = 80;
const isAmazon = (m: string) => /AMAZON|AMZN/.test(m.toUpperCase());

/** T36 / SPEC §8. The daily screen: everything gets reviewed, confidence only makes it quick. */
export function Review() {
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const queue = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => get<Queue>('/review/queue'),
  });
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const [done, setDone] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<QueueItem | null>(null);
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';

  const refresh = () =>
    Promise.all([
      invalidate(),
      qc.invalidateQueries({ queryKey: ['review-queue'] }),
      qc.invalidateQueries({ queryKey: ['queue-count'] }),
    ]);

  /** Hide rows at once so the queue keeps moving; put them back if the server says no. */
  const run = async (ids: string[], fn: () => Promise<void>) => {
    setError(null);
    setDone((d) => new Set([...d, ...ids]));
    try {
      await fn();
      await refresh();
    } catch (e) {
      setDone((d) => new Set([...d].filter((x) => !ids.includes(x))));
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    }
  };

  const accept = (t: QueueItem) =>
    run([t.id], async () => {
      await api('POST', '/transactions/bulk-accept', { ids: [t.id] });
    });

  const file = (t: QueueItem, categoryId: string) =>
    run([t.id], async () => {
      const res = await api<PatchedTransaction>('PATCH', `/transactions/${t.id}`, {
        categoryId,
        reviewState: 'reviewed',
      });
      if (res.ruleOffer) setOffer(res.ruleOffer);
    });

  const acceptAll = () =>
    run(
      (queue.data?.items ?? [])
        .filter((t) => t.suggestedCategoryId && t.suggestionConfidence >= 0.9)
        .map((t) => t.id),
      async () => {
        await api('POST', '/transactions/bulk-accept', { minConfidence: 0.9 });
      },
    );

  const items = (queue.data?.items ?? []).filter((t) => !done.has(t.id));
  const days = groupQueue(items);
  const confident = confidentCount(items);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <header className="gutter sticky top-0 z-10 grid min-h-14 grid-cols-[1fr_auto_1fr] items-center bg-canvas/95 backdrop-blur">
        <Link to="/" className="flex min-h-11 items-center gap-1 justify-self-start text-sage-700">
          <span aria-hidden>‹</span>
          Dashboard
        </Link>
        <h1 className="type-body font-semibold">Review</h1>
        <span />
      </header>

      <section className="gutter pt-4 pb-4">
        <p className="type-label text-ink-muted">Left to review</p>
        <p className="mt-1 type-display money">{queue.data ? items.length : '–'}</p>
        {confident > 0 && (
          <Button className="mt-4 w-full" onClick={() => void acceptAll()}>
            Accept all confident ({confident})
          </Button>
        )}
        {error && <p className="mt-2 text-clay">{error}</p>}
      </section>

      {!queue.data && (
        <div className="gutter flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {queue.data && items.length === 0 && (
        <p className="gutter py-8 text-center text-ink-muted">All caught up. Nothing waiting.</p>
      )}

      {days.map((day) => (
        <section key={day.date} className="pt-4">
          <h2 className="gutter flex items-baseline justify-between border-b border-hairline pb-1 type-label text-ink-muted">
            <span>{shortDate(day.date)}</span>
            {day.totalCents !== 0 && (
              <MoneyText
                cents={-day.totalCents}
                tone="muted"
                sign={day.totalCents < 0 ? 'always' : 'auto'}
              />
            )}
          </h2>
          <ul>
            {day.rows.map((row) =>
              row.kind === 'transfer' ? (
                <TransferRow
                  key={row.out.id}
                  out={row.out}
                  in={row.in}
                  from={accountName(row.out.accountId)}
                  to={accountName(row.in.accountId)}
                  onConfirm={() =>
                    run([row.out.id, row.in.id], async () => {
                      await Promise.all(
                        [row.out, row.in].map((t) =>
                          api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' }),
                        ),
                      );
                    })
                  }
                  onUnlink={() =>
                    run([], async () => {
                      await api('DELETE', `/transactions/${row.out.id}/transfer-link`);
                    })
                  }
                />
              ) : (
                <ReviewRow
                  key={row.t.id}
                  t={row.t}
                  band={row.band}
                  account={accountName(row.t.accountId)}
                  suggestion={catName(row.t.suggestedCategoryId)}
                  top={row.t.topCategoryIds
                    .map((id) => ({ id, name: catName(id) }))
                    .filter((c) => c.name)}
                  onAccept={() => void accept(row.t)}
                  onFile={(id) => void file(row.t, id)}
                  onPick={() => setPicking(row.t)}
                />
              ),
            )}
          </ul>
        </section>
      ))}

      {queue.data && queue.data.dropped.length > 0 && (
        <section className="gutter pt-10">
          <h2 className="type-label text-ink-muted">Pending charges that never posted</h2>
          <p className="mt-1 type-caption text-ink-faint">
            These sat pending for 14 days with no matching charge, so they no longer count toward
            spending.
          </p>
          <ul className="mt-2">
            {queue.data.dropped.map((t) => (
              <li
                key={t.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-2 text-ink-muted"
              >
                <span>
                  {t.merchantDisplay ?? t.merchantNormalized}
                  <span className="block type-caption text-ink-faint">
                    {shortDate(t.postedAt)} · {accountName(t.accountId)}
                  </span>
                </span>
                <MoneyText cents={-t.amountCents} tone="muted" className="line-through" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <CategoryPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(id) => {
          if (picking) void file(picking, id);
          setPicking(null);
        }}
      />
      <RuleOfferSheet offer={offer} onClose={() => setOffer(null)} />
    </div>
  );
}

function ReviewRow({
  t,
  band,
  account,
  suggestion,
  top,
  onAccept,
  onFile,
  onPick,
}: {
  t: QueueItem;
  band: 'confident' | 'guess' | 'none';
  account: string;
  suggestion: string;
  top: { id: string; name: string }[];
  onAccept: () => void;
  onFile: (categoryId: string) => void;
  onPick: () => void;
}) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const prefilled = band !== 'none' && suggestion !== '';
  const amazon = isAmazon(t.merchantNormalized);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') start.current = e.clientX;
  };
  const onMove = (e: PointerEvent) => {
    if (start.current !== null) setDx(Math.max(-120, Math.min(120, e.clientX - start.current)));
  };
  const onUp = () => {
    // Swipe right accepts a pre-fill; swipe left opens the picker (SPEC §8).
    if (dx > SWIPE_PX && prefilled) onAccept();
    else if (dx < -SWIPE_PX) onPick();
    start.current = null;
    setDx(0);
  };
  return (
    <li
      className={`gutter touch-pan-y border-b border-hairline py-3 transition-transform ${t.isPending ? 'italic' : ''}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="flex items-start justify-between gap-3">
        <Link to={`/transactions/${t.id}?from=${encodeURIComponent(FROM)}`} className="min-w-0">
          <span className="block truncate">
            {t.merchantDisplay ?? t.merchantNormalized}
            {t.isPending && (
              <span className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text">
                P
              </span>
            )}
          </span>
          <span className="block truncate type-caption text-ink-faint">{account}</span>
        </Link>
        <MoneyText cents={-t.amountCents} sign={t.amountCents < 0 ? 'always' : 'auto'} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {prefilled ? (
          <>
            <button
              onClick={onAccept}
              className={`min-h-11 rounded-full px-4 font-medium ${
                band === 'confident'
                  ? 'bg-sage-600 text-surface'
                  : 'border border-gold bg-surface text-gold-text'
              }`}
              aria-label={`Accept ${suggestion}`}
            >
              {band === 'confident' ? `✓ ${suggestion}` : `${suggestion}?`}
            </button>
            {band === 'guess' && <span className="type-caption text-ink-faint">Guess</span>}
          </>
        ) : (
          top.map((c) => (
            <button
              key={c.id}
              onClick={() => onFile(c.id)}
              className="min-h-11 rounded-full border border-hairline bg-surface px-4"
            >
              {c.name}
            </button>
          ))
        )}
        <button onClick={onPick} className="min-h-11 px-2 text-sage-700">
          {prefilled ? 'Change' : 'Other…'}
        </button>
        <Link
          to={`/transactions/${t.id}?split=1&from=${encodeURIComponent(FROM)}`}
          className={`flex min-h-11 items-center ${amazon ? 'rounded-full bg-sage-100 px-4 font-medium text-sage-700' : 'px-2 text-ink-muted'}`}
        >
          Split
        </Link>
      </div>
    </li>
  );
}

function TransferRow(p: {
  out: QueueItem;
  in: QueueItem;
  from: string;
  to: string;
  onConfirm: () => void;
  onUnlink: () => void;
}) {
  return (
    <li className="gutter border-b border-hairline py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">
            {p.from} → {p.to}
          </span>
          <span className="block type-caption text-ink-faint">
            Transfer · {shortDate(p.out.postedAt)}
            {p.out.postedAt !== p.in.postedAt ? ` and ${shortDate(p.in.postedAt)}` : ''} · not
            spending
          </span>
        </span>
        <MoneyText cents={p.out.amountCents} tone="muted" />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={p.onConfirm}
          className="min-h-11 rounded-full bg-sage-600 px-4 font-medium text-surface"
        >
          ✓ Transfer
        </button>
        <button onClick={p.onUnlink} className="min-h-11 px-2 text-sage-700">
          Not a transfer
        </button>
      </div>
    </li>
  );
}
