import type { RuleOffer, Transaction } from '@rise/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CategoryPicker } from '../components/CategoryPicker';
import { RuleOfferSheet } from '../components/RuleOfferSheet';
import { TxnAmount } from '../components/TxnAmount';
import { Button } from '../components/primitives/Button';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get, isQueuedOffline } from '../lib/api';
import { usePendingChanges } from '../components/OfflineBar';
import { shortDate } from '../lib/dates';
import { useAccounts, useCategories, useGroups, useInvalidateMoney } from '../lib/queries';
import { transitionClick } from '../lib/transition';
import {
  chipsFor,
  confidentCount,
  groupQueue,
  transferOffer,
  type ChipContext,
  type QueueItem,
  type QueueRow,
} from '../lib/review';
import type { PatchedTransaction } from '../lib/types';

interface Queue {
  count: number;
  items: QueueItem[];
  dropped: Transaction[];
  frequentCategoryIds: string[];
}

/** An action waiting out its undo window. Nothing reaches the server until it lapses. */
interface Pending {
  ids: string[];
  label: string;
  commit: () => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

const FROM = 'Review|/review';
const SWIPE_PX = 80;
const UNDO_MS = 5000;
const isAmazon = (m: string) => /AMAZON|AMZN/.test(m.toUpperCase());

/**
 * T36 / SPEC §8. The daily screen: everything gets reviewed, so every row is one tap —
 * a pre-fill to accept, or the merchant's (or your) usual categories. Each action waits five
 * seconds behind an Undo before it is sent.
 */
export function Review() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const invalidate = useInvalidateMoney();
  const queue = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => get<Queue>('/review/queue'),
  });
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const groups = useGroups().data ?? [];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const [picking, setPicking] = useState<QueueItem | null>(null);
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = (id: string) => accounts.find((a) => a.id === id);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';
  const kindOf = new Map(groups.map((g) => [g.id, g.kind]));
  const ctx: ChipContext = {
    kinds: new Map(categories.map((c) => [c.id, kindOf.get(c.groupId) ?? 'expense'])),
    ordered: categories.map((c) => c.id),
    frequent: queue.data?.frequentCategoryIds ?? [],
    quiet: new Set(categories.filter((c) => !c.budgeted || c.isCatchall).map((c) => c.id)),
  };

  const unhide = (ids: string[]) =>
    setHidden((h) => new Set([...h].filter((x) => !ids.includes(x))));

  /** Send the waiting action now. A failure brings its rows back and says why. */
  const flush = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    setToast(null);
    try {
      await p.commit();
    } catch (e) {
      // Offline, the change waits on this device and the row stays filed.
      if (isQueuedOffline(e)) return;
      unhide(p.ids);
      setError(e instanceof ApiError ? e.message : `Could not save: ${p.label}`);
      return;
    }
    await Promise.all([
      invalidate(),
      qc.invalidateQueries({ queryKey: ['review-queue'] }),
      qc.invalidateQueries({ queryKey: ['queue-count'] }),
    ]);
  }, [invalidate, qc]);

  const act = (ids: string[], label: string, commit: () => Promise<void>) => {
    setError(null);
    void flush();
    setHidden((h) => new Set([...h, ...ids]));
    pending.current = { ids, label, commit, timer: setTimeout(() => void flush(), UNDO_MS) };
    setToast(label);
  };

  const undo = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    unhide(p.ids);
    setToast(null);
  };

  // Leaving the screen or the app sends what's waiting rather than dropping it. Through a
  // ref, so this runs on unmount only — not on every render.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flushRef.current();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flushRef.current();
    };
  }, []);

  const name = (t: QueueItem) => t.merchantDisplay ?? t.merchantNormalized;
  const accept = (t: QueueItem) =>
    act([t.id], `${name(t)} → ${catName(t.suggestedCategoryId)}`, async () => {
      await api(
        'POST',
        '/transactions/bulk-accept',
        { ids: [t.id] },
        { label: `${name(t)} → ${catName(t.suggestedCategoryId)}` },
      );
    });
  const file = (t: QueueItem, categoryId: string) =>
    act([t.id], `${name(t)} → ${catName(categoryId)}`, async () => {
      const res = await api<PatchedTransaction>(
        'PATCH',
        `/transactions/${t.id}`,
        { categoryId, reviewState: 'reviewed' },
        { label: `${name(t)} → ${catName(categoryId)}` },
      );
      if (res.ruleOffer) setOffer(res.ruleOffer);
    });
  const markTransfer = (t: QueueItem) =>
    act([t.id], `${name(t)} → not spending`, async () => {
      await api('POST', `/transactions/${t.id}/mark-transfer`, undefined, {
        label: `${name(t)} as a transfer`,
      });
    });

  // Rows already filed offline stay filed across a restart, before the queue has sent.
  const waiting = usePendingChanges();
  const queued = (id: string) =>
    waiting.some(
      (e) =>
        e.path.startsWith(`/transactions/${id}`) ||
        ((e.body as { ids?: string[] } | null)?.ids ?? []).includes(id),
    );
  const items = (queue.data?.items ?? []).filter((t) => !hidden.has(t.id) && !queued(t.id));
  const days = groupQueue(items);
  const confident = items.filter(
    (t) => t.suggestedCategoryId && !t.isTransfer && t.suggestionConfidence >= 0.9,
  );
  const acceptAll = () =>
    act(
      confident.map((t) => t.id),
      `${confident.length} confident ${confident.length === 1 ? 'match' : 'matches'} accepted`,
      async () => {
        await api('POST', '/transactions/bulk-accept', { ids: confident.map((t) => t.id) });
      },
    );
  const confirmPair = (row: Extract<QueueRow, { kind: 'transfer' }>) =>
    act([row.out.id, row.in.id], 'Transfer confirmed', async () => {
      await Promise.all(
        [row.out, row.in].map((t) =>
          api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' }),
        ),
      );
    });

  // Desktop: the top row answers to the keyboard.
  const first = days[0]?.rows[0];
  const sheetOpen = picking !== null || offer !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (sheetOpen || e.metaKey || e.altKey || el?.closest('input, select, textarea')) return;
      if (e.key === 'u' || (e.key === 'z' && e.ctrlKey)) return undo();
      if (!first) return;
      if (first.kind === 'transfer') {
        if (e.key === 'Enter') confirmPair(first);
        return;
      }
      const t = first.t;
      const chips = chipsFor(t, ctx, 2);
      const n = Number(e.key);
      if (n >= 1 && n <= chips.length) file(t, chips[n - 1] as string);
      else if (e.key === 'Enter' && t.suggestedCategoryId && first.band !== 'none') accept(t);
      else if (e.key === 'o' || e.key === '/') setPicking(t);
      else if (e.key === 's')
        void nav(`/transactions/${t.id}?split=1&from=${encodeURIComponent(FROM)}`);
      else if (e.key === 't' && transferOffer(t, account(t.accountId)?.kind)) markTransfer(t);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <header className="gutter sticky top-[var(--banner-h,0px)] z-10 grid min-h-14 grid-cols-[1fr_auto_1fr] items-center bg-canvas/95 backdrop-blur">
        <Link to="/" className="flex min-h-11 items-center gap-1 justify-self-start text-sage-700">
          <span aria-hidden>‹</span>
          Dashboard
        </Link>
        <h1 className="type-body font-semibold">
          Review <span className="money text-ink-muted">{queue.data ? items.length : ''}</span>
        </h1>
        <span />
      </header>

      {confident.length > 0 && (
        <section className="gutter pt-2 pb-2">
          <Button className="w-full" onClick={acceptAll}>
            Accept all confident ({confidentCount(items)})
          </Button>
        </section>
      )}
      {error && <p className="gutter py-2 text-clay">{error}</p>}
      <p className="gutter hidden pt-2 type-caption text-ink-faint md:block">
        Keys for the top row: 1–3 file · Enter accepts · O other · S split · T transfer · U undo
      </p>

      {!queue.data && (
        <div className="gutter flex flex-col gap-2 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {queue.data && items.length === 0 && (
        <div className="gutter py-16 text-center">
          <p className="type-title">All caught up.</p>
          <p className="mt-1 text-ink-muted">
            Nothing waiting. New charges land here after each sync.
          </p>
        </div>
      )}

      {days.map((day) => (
        <section key={day.date} className="pt-3">
          <h2 className="gutter flex items-baseline justify-between border-b border-hairline pb-1 type-label text-ink-muted">
            <span>{shortDate(day.date)}</span>
            {day.totalCents > 0 && <MoneyText cents={day.totalCents} tone="muted" />}
          </h2>
          <ul>
            {day.rows.map((row) =>
              row.kind === 'transfer' ? (
                <TransferRow
                  key={row.out.id}
                  out={row.out}
                  in={row.in}
                  from={account(row.out.accountId)?.name ?? ''}
                  to={account(row.in.accountId)?.name ?? ''}
                  focused={row === first}
                  onConfirm={() => confirmPair(row)}
                  onUnlink={() =>
                    act([], 'Unlinked', async () => {
                      await api('DELETE', `/transactions/${row.out.id}/transfer-link`);
                    })
                  }
                />
              ) : (
                <ReviewRow
                  key={row.t.id}
                  t={row.t}
                  band={row.band}
                  focused={row === first}
                  account={account(row.t.accountId)?.name ?? ''}
                  suggestion={catName(row.t.suggestedCategoryId)}
                  chips={chipsFor(row.t, ctx, 2).map((id) => ({ id, name: catName(id) }))}
                  offer={transferOffer(row.t, account(row.t.accountId)?.kind)}
                  onAccept={() => accept(row.t)}
                  onFile={(id) => file(row.t, id)}
                  onTransfer={() => markTransfer(row.t)}
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
          <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {queue.data.dropped.map((t) => (
              <li
                key={t.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-2 text-ink-muted"
              >
                <span>
                  {t.merchantDisplay ?? t.merchantNormalized}
                  <span className="block type-caption text-ink-faint">
                    {shortDate(t.postedAt)} · {account(t.accountId)?.name}
                  </span>
                </span>
                <MoneyText cents={Math.abs(t.amountCents)} tone="muted" className="line-through" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-[min(100%-32px,560px)] items-center justify-between gap-3 rounded-card bg-ink px-4 py-2 text-surface shadow-soft"
        >
          <span className="min-w-0 truncate">{toast}</span>
          <button onClick={undo} className="min-h-11 shrink-0 px-2 font-semibold text-sage-100">
            Undo
          </button>
        </div>
      )}

      <CategoryPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(id) => {
          if (picking) file(picking, id);
          setPicking(null);
        }}
      />
      <RuleOfferSheet offer={offer} onClose={() => setOffer(null)} />
    </div>
  );
}

const chip = 'min-h-11 shrink-0 rounded-full px-3.5 whitespace-nowrap';

function ReviewRow({
  t,
  band,
  focused,
  account,
  suggestion,
  chips,
  offer,
  onAccept,
  onFile,
  onTransfer,
  onPick,
}: {
  t: QueueItem;
  band: 'confident' | 'guess' | 'none';
  focused: boolean;
  account: string;
  suggestion: string;
  chips: { id: string; name: string }[];
  offer: 'card_payment' | 'transfer' | null;
  onAccept: () => void;
  onFile: (categoryId: string) => void;
  onTransfer: () => void;
  onPick: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const prefilled = band !== 'none' && suggestion !== '';
  const amazon = isAmazon(t.merchantNormalized);
  const navigate = useNavigate();
  const detailTo = `/transactions/${t.id}?from=${encodeURIComponent(FROM)}`;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') start.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    // A mostly vertical drag is a scroll, not a swipe.
    if (Math.abs(e.clientY - s.y) > Math.abs(e.clientX - s.x)) return;
    setDx(Math.max(-120, Math.min(120, e.clientX - s.x)));
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
      className={`touch-pan-y border-b border-hairline py-2 transition-transform md:border-l-2 ${
        focused ? 'md:border-l-sage-600' : 'md:border-l-transparent'
      }`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <Link
        to={detailTo}
        onClick={transitionClick(navigate, detailTo)}
        className={`gutter flex items-baseline justify-between gap-3 ${t.isPending ? 'italic' : ''}`}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="max-w-[75%] shrink-0 truncate">
            {t.merchantDisplay ?? t.merchantNormalized}
          </span>
          {t.isPending && (
            <span
              title="Pending"
              className="shrink-0 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
            >
              P
            </span>
          )}
          <span className="min-w-0 truncate type-caption text-ink-faint not-italic">{account}</span>
        </span>
        <TxnAmount t={t} className="shrink-0" />
      </Link>
      <div className="gutter mt-1 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {prefilled && (
          <button
            onClick={onAccept}
            aria-label={`Accept ${suggestion}${band === 'guess' ? ' (a guess)' : ''}`}
            className={`${chip} font-medium ${
              band === 'confident'
                ? 'bg-sage-600 text-surface'
                : 'border border-dashed border-gold bg-surface text-gold-text'
            }`}
          >
            {band === 'confident' ? `✓ ${suggestion}` : `${suggestion}?`}
          </button>
        )}
        {offer && suggestion !== 'Transfer' && suggestion !== 'Credit Card Payment' && (
          <button
            onClick={onTransfer}
            className={`${chip} border border-hairline bg-surface text-ink-muted`}
          >
            {offer === 'card_payment' ? 'Card payment' : 'Transfer'}
          </button>
        )}
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => onFile(c.id)}
            className={`${chip} border border-hairline bg-surface`}
          >
            {c.name}
          </button>
        ))}
        <button onClick={onPick} className={`${chip} px-3 text-sage-700`}>
          More…
        </button>
        <Link
          to={`/transactions/${t.id}?split=1&from=${encodeURIComponent(FROM)}`}
          onClick={transitionClick(
            navigate,
            `/transactions/${t.id}?split=1&from=${encodeURIComponent(FROM)}`,
          )}
          className={`${chip} flex items-center ${amazon ? 'bg-sage-100 font-medium text-sage-700' : 'px-3 text-ink-muted'}`}
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
  focused: boolean;
  onConfirm: () => void;
  onUnlink: () => void;
}) {
  return (
    <li
      className={`border-b border-hairline py-2 md:border-l-2 ${p.focused ? 'md:border-l-sage-600' : 'md:border-l-transparent'}`}
    >
      <div className="gutter flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">
            {p.from} → {p.to}
          </span>
          <span className="shrink-0 type-caption text-ink-faint">Transfer · not spending</span>
        </span>
        <MoneyText cents={p.out.amountCents} tone="muted" className="shrink-0" />
      </div>
      <div className="gutter mt-1 flex gap-2">
        <button onClick={p.onConfirm} className={`${chip} bg-sage-600 font-medium text-surface`}>
          ✓ Transfer
        </button>
        <button onClick={p.onUnlink} className={`${chip} px-3 text-sage-700`}>
          Not a transfer
        </button>
      </div>
    </li>
  );
}
