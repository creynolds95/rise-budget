import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { edgeWidth } from '../lib/gestures';
import { ApiError, api, get } from '../lib/api';
import { showFloater } from '../lib/floater';
import { useInvalidateMoney } from '../lib/queries';
import { type SyncRunResult, syncNote } from '../lib/syncOutcome';
import {
  dailyRoom,
  isArmed,
  judgePull,
  PULL_THRESHOLD,
  pullOffset,
  syncDue,
} from '../lib/pullRefresh';
import type { SyncStatus } from '../lib/types';
import { scroller } from '../lib/scroller';

const LAST_SYNC_KEY = 'rise-pull-sync-at';
/** The spinner never waits longer than this for the data refetch. */
const REFETCH_TIMEOUT_MS = 8000;
const NOTE_MS = 3000;

const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

/** Whether a bank sync is due now: over an hour since the last one (here or scheduled), room in the day. */
async function bankSyncDue(qc: QueryClient): Promise<boolean> {
  let mine: number | null = null;
  try {
    mine = Number(localStorage.getItem(LAST_SYNC_KEY)) || null;
  } catch {
    /* storage blocked: the server's own history still limits it */
  }
  const status = await qc.fetchQuery({
    queryKey: ['sync'],
    queryFn: () => get<SyncStatus>('/sync/status'),
    staleTime: 0,
  });
  if (status.mode === 'off') return false;
  const now = Date.now();
  // Scheduled syncs run on the owner's clock times regardless of this; the daily cap only keeps
  // pulls from using up the requests those need.
  return (
    syncDue(now, mine, status.runs[0]?.startedAt) &&
    dailyRoom(
      now,
      status.runs.map((r) => r.startedAt),
    )
  );
}

/**
 * Pull = refetch Rise's data (the spinner waits for this, capped), and when a bank sync is due start
 * it in the background with its own floating note, so a slow bank never keeps the spinner up.
 */
async function refreshAll(qc: QueryClient, invalidate: () => Promise<unknown>) {
  const due = bankSyncDue(qc).catch(() => null); // null: offline or unknown
  await within(
    qc.refetchQueries({ type: 'active' }).catch(() => {}),
    REFETCH_TIMEOUT_MS,
  );
  const go = await within(due, 3000);
  if (go === false) {
    showFloater({ text: 'Synced recently', ttlMs: NOTE_MS });
    return;
  }
  if (go !== true) return;
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  showFloater({ text: 'Syncing banks…', busy: true });
  void api<SyncRunResult>('POST', '/sync/run', {})
    .then(async (r) => {
      const n = syncNote(r);
      showFloater({ ...n, ttlMs: n.tone === 'warn' ? undefined : NOTE_MS });
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['sync'] })]);
    })
    .catch((e) =>
      showFloater({ text: e instanceof ApiError ? e.message : 'Sync failed', tone: 'warn' }),
    );
}

const SKIP = '[data-zoomable], [data-no-swipe], input, textarea, select, [role=dialog]';

/**
 * Drag down from the top of a tab screen to refetch its data in place (no reload, no splash;
 * asks the bank for new transactions at most once an hour). Phone layout only (the scroller is
 * `#app-scroll`); a touch starts a pull only when that container is scrolled to the very top,
 * starts clear of the left edge strip, and turns out to be mostly vertical, so the menu drag and
 * the swipe-back guard keep their gestures. The page and the wheat emblem are moved directly, not through state.
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const dot = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'idle' | 'pull' | 'loading' = 'idle';
    let top = 0;

    // The page itself (`main`, inside the scroller) is pulled down with the finger, so the bars stay
    // put and the emblem sits in the gap that opens above the content.
    const page = () => scroller()?.firstElementChild as HTMLElement | null;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const move = (px: number, ease: boolean) => {
      const m = page();
      if (!m) return;
      clearTimeout(clear);
      m.style.transition = ease ? 'transform 220ms cubic-bezier(0.2,0.8,0.3,1)' : 'none';
      m.style.transform = px > 0 ? `translateY(${px}px)` : px === 0 && ease ? 'translateY(0)' : '';
      // A leftover transform would become the containing block for fixed descendants.
      if (px === 0 && ease) {
        clear = setTimeout(() => {
          m.style.transform = '';
          m.style.transition = '';
        }, 240);
      }
    };
    const paint = (offset: number, armed: boolean, spin: boolean) => {
      const el = dot.current;
      if (!el) return;
      el.style.top = `${top}px`;
      el.style.opacity = String(spin ? 1 : Math.min(1, offset / 36));
      el.style.transform = `translate(-50%, ${Math.max(0, offset / 2 - 18)}px)`;
      el.style.setProperty('--pull', String(Math.min(1, offset / pullOffset(PULL_THRESHOLD))));
      el.dataset['armed'] = armed ? '1' : '0';
      el.dataset['spin'] = spin ? '1' : '0';
    };
    const reset = () => {
      const el = dot.current;
      if (el) el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
      paint(0, false, false);
      move(0, true);
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      const t = e.touches[0];
      const el = e.target as Element | null;
      const sc = scroller();
      if (mode === 'loading' || !t || e.touches.length !== 1 || !sc || sc.scrollTop > 0) return;
      if (t.clientX <= edgeWidth(window.location.pathname) || el?.closest(SKIP)) return;
      top = sc.getBoundingClientRect().top;
      start = { x: t.clientX, y: t.clientY };
      mode = 'idle';
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t || mode === 'loading') return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (mode === 'idle') {
        const v = judgePull(dx, dy);
        if (v === 'undecided') return;
        if (v === 'ignore' || (scroller()?.scrollTop ?? 1) > 0) {
          start = null;
          return;
        }
        mode = 'pull';
        const el = dot.current;
        if (el) el.style.transition = 'none';
      }
      // Our own rubber band replaces iOS's, so the whole page follows the finger.
      if (e.cancelable) e.preventDefault();
      const off = pullOffset(dy);
      move(off, false);
      paint(off, isArmed(dy), false);
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const wasPull = mode === 'pull';
      const dy = start && t ? t.clientY - start.y : 0;
      start = null;
      if (!wasPull) return;
      if (isArmed(dy)) {
        mode = 'loading';
        const el = dot.current;
        if (el) el.style.transition = 'transform 150ms ease-out';
        paint(pullOffset(PULL_THRESHOLD), true, true);
        move(pullOffset(PULL_THRESHOLD), true);
        const minimum = new Promise((r) => setTimeout(r, 500));
        void Promise.all([
          refreshAll(qc, () => invalidateRef.current()).catch(() => {}),
          minimum,
        ]).then(() => {
          mode = 'idle';
          reset();
        });
      } else {
        mode = 'idle';
        reset();
      }
    };
    const onCancel = () => {
      start = null;
      if (mode === 'pull') {
        mode = 'idle';
        reset();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled, qc]);

  if (!enabled) return null;
  return (
    <div
      ref={dot}
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-10 flex size-9 items-center justify-center text-sage-700 opacity-0"
      style={{ transform: 'translate(-50%, 0)' }}
    >
      {/* A wheat ear: grains fill in as the pull grows, then it sways while reloading. */}
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        className="pull-icon fill-none stroke-current"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22V9" />
        <path className="pull-grain" d="M12 9c-2.5-.5-3-3-3-4.5 2.5.3 3 2.5 3 4.5Z" />
        <path className="pull-grain" d="M12 9c2.5-.5 3-3 3-4.5-2.5.3-3 2.5-3 4.5Z" />
        <path className="pull-grain" d="M12 14c-2.5-.5-3.5-3-3.5-4.5 2.5.3 3.5 2.5 3.5 4.5Z" />
        <path className="pull-grain" d="M12 14c2.5-.5 3.5-3 3.5-4.5-2.5.3-3.5 2.5-3.5 4.5Z" />
        <path className="pull-grain" d="M12 19c-2.5-.5-3.5-3-3.5-4.5 2.5.3 3.5 2.5 3.5 4.5Z" />
        <path className="pull-grain" d="M12 19c2.5-.5 3.5-3 3.5-4.5-2.5.3-3.5 2.5-3.5 4.5Z" />
        <path d="M12 9V3" />
      </svg>
    </div>
  );
}
