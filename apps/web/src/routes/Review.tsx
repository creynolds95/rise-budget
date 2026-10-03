import type { RuleOffer, Transaction } from '@rise/shared/schemas';
import { merchantName } from '../lib/merchant';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSwipeBack } from '../lib/gestures';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BackLink } from '../components/BackLink';
import { CategoryPicker } from '../components/CategoryPicker';
import { RuleOfferSheet } from '../components/RuleOfferSheet';
import { TxnAmount } from '../components/TxnAmount';
import { Button } from '../components/primitives/Button';
import { Chevron } from '../components/primitives/Rows';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get, isQueuedOffline } from '../lib/api';
import { usePendingChanges } from '../components/OfflineBar';
import { shortDate } from '../lib/dates';
import { useAccounts, useCategories, useInvalidateMoney } from '../lib/queries';
import { transitionClick } from '../lib/transition';
import {
  currentCategoryId,
  groupQueue,
  transferOffer,
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
 * T36 / SPEC §8. The daily screen: every row shows its best guess and one tap confirms it;
 * tapping the guess picks another. Each action waits five seconds behind an Undo before it
 * is sent.
 */
export function Review() {
  const qc = useQueryClient();
  const nav = useNavigate();
  useSwipeBack('/');
  const invalidate = useInvalidateMoney();
  const queue = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => get<Queue>('/review/queue'),
  });
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const [picking, setPicking] = useState<QueueItem | null>(null);
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = (id: string) => accounts.find((a) => a.id === id);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';
  const catEmoji = (id: string | null) => categories.find((c) => c.id === id)?.emoji;
  /** The suggestion when there is one worth offering, else what the row is filed under. */
  const guessId = (t: QueueItem, band: 'confident' | 'guess' | 'none') =>
    band !== 'none' && t.suggestedCategoryId ? t.suggestedCategoryId : currentCategoryId(t);
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

  const name = (t: QueueItem) => merchantName(t);
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
  const confirmPair = (row: Extract<QueueRow, { kind: 'transfer' }>) =>
    act([row.out.id, row.in.id], 'Transfer confirmed', async () => {
      await Promise.all(
        [row.out, row.in].map((t) =>
          api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' }),
        ),
      );
    });

  /** Confirm one row's guess: accept the suggestion, or keep what it is filed under. */
  const confirm = (t: QueueItem, band: 'confident' | 'guess' | 'none') => {
    const id = guessId(t, band);
    if (!id) return null;
    return id === t.suggestedCategoryId && band !== 'none' ? () => accept(t) : () => file(t, id);
  };
  const confirmAll = () => {
    const rows = days.flatMap((d) => d.rows);
    const pairs = rows.flatMap((r) => (r.kind === 'transfer' ? [r.out, r.in] : []));
    const singles = rows.flatMap((r) => {
      if (r.kind === 'transfer') return [];
      const id = guessId(r.t, r.band);
      return id ? [{ t: r.t, id }] : [];
    });
    const accepted = singles.filter((s) => s.id === s.t.suggestedCategoryId).map((s) => s.t.id);
    const kept = singles.filter((s) => s.id !== s.t.suggestedCategoryId);
    const n = pairs.length / 2 + singles.length;
    act([...pairs.map((t) => t.id), ...singles.map((s) => s.t.id)], `${n} confirmed`, async () => {
      await Promise.all([
        accepted.length > 0 &&
          api('POST', '/transactions/bulk-accept', { ids: accepted }, { label: `${n} confirmed` }),
        ...kept.map((s) =>
          api('PATCH', `/transactions/${s.t.id}`, { categoryId: s.id, reviewState: 'reviewed' }),
        ),
        ...pairs.map((t) => api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' })),
      ]);
    });
  };

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
      const ok = confirm(t, first.band);
      if (e.key === 'Enter' && ok) ok();
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
      <header className="gutter sticky top-[var(--banner-h,0px)] z-10 grid grid-cols-[1fr_auto_1fr] items-center banner bg-banner text-banner-ink shadow-soft">
        <BackLink to="/" label="Dashboard" />
        <h1 className="type-body font-semibold">Needs review</h1>
        <span />
      </header>

      {error && <p className="gutter py-2 text-clay">{error}</p>}
      <p className="gutter hidden pt-2 type-caption text-ink-faint md:block">
        Keys for the top row: Enter confirms · O other · S split · T transfer · U undo
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
        <section key={day.date} className="gutter pt-6">
          <h2 className="type-label text-ink-muted">{shortDate(day.date)}</h2>
          <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
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
                  guess={catName(guessId(row.t, row.band))}
                  emoji={catEmoji(guessId(row.t, row.band))}
                  offer={transferOffer(row.t, account(row.t.accountId)?.kind)}
                  onConfirm={confirm(row.t, row.band)}
                  onTransfer={() => markTransfer(row.t)}
                  onPick={() => setPicking(row.t)}
                />
              ),
            )}
          </ul>
        </section>
      ))}

      {items.length > 0 && (
        <section className="gutter pt-6">
          <Button className="w-full" onClick={confirmAll}>
            Confirm all
          </Button>
        </section>
      )}

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
                  {merchantName(t)}
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
          className="fixed inset-x-0 bottom-[calc(max(16px,env(safe-area-inset-bottom))+72px)] z-30 lg:bottom-4 mx-auto flex w-[min(100%-32px,560px)] items-center justify-between gap-3 rounded-card bg-ink px-4 py-2 text-surface shadow-soft"
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

/** The one confirm button every row ends on. */
function ConfirmButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage-600 text-surface active:brightness-95"
    >
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        className="fill-none stroke-current"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.5 10 17.5 19 7" />
      </svg>
    </button>
  );
}

const quietAction = 'min-h-11 shrink-0 px-2 text-sage-700';

function ReviewRow({
  t,
  band,
  focused,
  account,
  guess,
  emoji,
  offer,
  onConfirm,
  onTransfer,
  onPick,
}: {
  t: QueueItem;
  band: 'confident' | 'guess' | 'none';
  focused: boolean;
  account: string;
  /** The suggestion when there is one, else the category it is filed under now. */
  guess: string;
  emoji: string | null | undefined;
  offer: 'card_payment' | 'transfer' | null;
  onConfirm: (() => void) | null;
  onTransfer: () => void;
  onPick: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const amazon = isAmazon(t.merchantNormalized);
  const navigate = useNavigate();
  const detailTo = `/transactions/${t.id}?from=${encodeURIComponent(FROM)}`;
  const splitTo = `/transactions/${t.id}?split=1&from=${encodeURIComponent(FROM)}`;
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
    // Swipe right confirms the guess; swipe left opens the picker (SPEC §8).
    if (dx > SWIPE_PX && onConfirm) onConfirm();
    else if (dx < -SWIPE_PX) onPick();
    start.current = null;
    setDx(0);
  };
  return (
    <li
      className={`touch-pan-y border-b border-hairline py-3 transition-transform last:border-b-0 md:border-l-2 md:pl-2 ${
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
        className={`flex items-center justify-between gap-3 active:opacity-70 ${t.isPending ? 'italic' : ''}`}
      >
        <span className="min-w-0">
          <span className="block truncate">
            {emoji && (
              <span aria-hidden className="mr-2 not-italic">
                {emoji}
              </span>
            )}
            {merchantName(t)}
            {t.isPending && (
              <span
                title="Pending"
                className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
              >
                P
              </span>
            )}
          </span>
          <span className="block truncate type-caption text-ink-faint not-italic">{account}</span>
        </span>
        <TxnAmount t={t} className="shrink-0" />
      </Link>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onPick}
          aria-label={`Category: ${guess || 'none'}. Change`}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-input bg-canvas px-3 text-left active:bg-sage-100"
        >
          <span className={`truncate ${band === 'guess' ? 'text-gold-text' : ''}`}>
            {guess ? `${guess}${band === 'guess' ? '?' : ''}` : 'Choose a category'}
          </span>
          <Chevron />
        </button>
        {offer && guess !== 'Transfer' && guess !== 'Credit Card Payment' && (
          <button type="button" onClick={onTransfer} className={quietAction}>
            {offer === 'card_payment' ? 'Card payment' : 'Transfer'}
          </button>
        )}
        {amazon && (
          <Link
            to={splitTo}
            onClick={transitionClick(navigate, splitTo)}
            className={`${quietAction} flex items-center`}
          >
            Split
          </Link>
        )}
        {onConfirm && <ConfirmButton label={`Confirm ${guess}`} onClick={onConfirm} />}
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
      className={`border-b border-hairline py-3 last:border-b-0 md:border-l-2 md:pl-2 ${p.focused ? 'md:border-l-sage-600' : 'md:border-l-transparent'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">
            {p.from} → {p.to}
          </span>
          <span className="block type-caption text-ink-faint">Transfer · not spending</span>
        </span>
        <MoneyText cents={p.out.amountCents} tone="muted" className="shrink-0" />
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <button type="button" onClick={p.onUnlink} className={quietAction}>
          Not a transfer
        </button>
        <ConfirmButton label="Confirm transfer" onClick={p.onConfirm} />
      </div>
    </li>
  );
}
