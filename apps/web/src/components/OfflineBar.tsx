import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ApiError,
  isDbLimited,
  isOnline,
  onDbLimitChange,
  onConnectivityChange,
  onOutboxChange,
  outbox,
  probe,
  replayOutbox,
} from '../lib/api';
import type { OutboxEntry } from '../lib/outbox';
import type { Query, QueryClient } from '@tanstack/react-query';

export function useOnline(): boolean {
  return useSyncExternalStore(onConnectivityChange, isOnline, () => true);
}

/** The free daily database allowance is spent; reads show saved data until it resets. */
export function useDbLimited(): boolean {
  return useSyncExternalStore(onDbLimitChange, isDbLimited, () => false);
}

/** Changes waiting on this device to be sent. */
export function usePendingChanges(): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    const load = () => void outbox.pending().then(setEntries);
    load();
    return onOutboxChange(load);
  }, []);
  return entries;
}

/** A screen is waiting on a read that has nothing cached and has failed or can't start. */
function isStuck(q: Query): boolean {
  return (
    q.getObserversCount() > 0 &&
    q.state.data === undefined &&
    (q.state.status === 'error' || q.state.fetchStatus === 'paused')
  );
}

function stuckCount(qc: QueryClient): number {
  return qc.getQueryCache().getAll().filter(isStuck).length;
}

/**
 * An on-screen read whose refresh failed while it still shows its last good answer. The
 * daily-limit bar covers that one cause already.
 */
function isRefreshFailed(q: Query): boolean {
  const e = q.state.error;
  return (
    q.getObserversCount() > 0 &&
    q.state.data !== undefined &&
    q.state.status === 'error' &&
    q.state.fetchStatus === 'idle' &&
    !(e instanceof ApiError && e.code === 'DB_LIMIT')
  );
}

/** When the oldest answer on screen that failed to refresh was fetched, or 0 for none. */
function failedSince(qc: QueryClient): number {
  const at = qc
    .getQueryCache()
    .getAll()
    .filter(isRefreshFailed)
    .map((q) => q.state.dataUpdatedAt);
  return at.length ? Math.min(...at) : 0;
}

export function useRefreshFailedSince(): number {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (fn) => qc.getQueryCache().subscribe(fn),
    () => failedSince(qc),
    () => 0,
  );
}

/** How many on-screen reads have nothing to show and no way to get it without help (C5). */
export function useStuckQueries(): number {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (fn) => qc.getQueryCache().subscribe(fn),
    () => stuckCount(qc),
    () => 0,
  );
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * SPEC §10: never show stale data as live. While offline, a bar names when the data on
 * screen was last fetched and how many changes are waiting; back online, the queue replays
 * in order and anything the server refused is said out loud.
 */
export function OfflineBar() {
  const online = useOnline();
  const pending = usePendingChanges();
  const qc = useQueryClient();
  const [refused, setRefused] = useState<string[]>([]);
  const stuck = useStuckQueries();
  const limited = useDbLimited();
  const staleSince = useRefreshFailedSince();
  const retry = () => {
    void probe();
    void qc.refetchQueries({ predicate: isStuck });
  };

  // While offline, check back: the browser's own online event can't tell a working
  // connection from lie-fi, and nothing else may be asking the server.
  useEffect(() => {
    if (online) return;
    const check = () => void probe();
    window.addEventListener('online', check);
    const t = setInterval(check, 15_000);
    return () => {
      window.removeEventListener('online', check);
      clearInterval(t);
    };
  }, [online]);

  // iOS suspends network activity while the PWA is backgrounded (C6 follow-up): a fetch in
  // flight when that happens fails with retries already spent, and the `online` event never
  // fires because the OS never considered the device offline. Coming back to the foreground
  // is the only signal, so a stuck read retries itself there instead of waiting on the next
  // unrelated action (or the person noticing the Retry link) to shake it loose.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void qc.refetchQueries({ predicate: isStuck });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [qc]);

  useEffect(() => {
    if (!online || pending.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const r = await replayOutbox();
      if (cancelled) return;
      if (r.rejected.length)
        setRefused((x) => [...x, ...r.rejected.map((j) => `${j.entry.label}: ${j.reason}`)]);
      if (r.sent || r.rejected.length) await qc.invalidateQueries();
    };
    void run();
    const t = setInterval(() => void run(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [online, pending.length, qc]);

  const updatedAt = Math.max(
    0,
    ...qc
      .getQueryCache()
      .getAll()
      .map((q) => q.state.dataUpdatedAt),
  );
  const waiting =
    pending.length > 0
      ? ` · ${pending.length} ${pending.length === 1 ? 'change' : 'changes'} waiting to send`
      : '';
  const text = !online
    ? `Offline · showing data from ${updatedAt ? stamp(updatedAt) : 'earlier'}${waiting}`
    : pending.length > 0
      ? `Sending ${pending.length} saved ${pending.length === 1 ? 'change' : 'changes'}…`
      : null;
  // Without this a failed or offline first load is an endless skeleton (C5).
  const failed =
    stuck > 0
      ? online
        ? "Couldn't load this screen"
        : "This screen isn't saved on this device yet"
      : null;
  // SPEC §10 again: data shown after a failed refresh is stale, and says so, quietly.
  const stale =
    online && !limited && staleSince > 0
      ? `Couldn't refresh · data from ${stamp(staleSince)}`
      : null;
  const show = text !== null || refused.length > 0 || failed !== null || limited || stale !== null;

  // Sticky headers sit below the bar rather than under it, however many rows it has.
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    // The safe-area inset is already padded for by the page itself.
    const set = () =>
      document.documentElement.style.setProperty(
        '--banner-h',
        `${el ? el.offsetHeight - parseFloat(getComputedStyle(el).paddingTop) : 0}px`,
      );
    set();
    if (!el) return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [show]);

  if (!show) return null;
  return (
    <div
      ref={bar}
      role="status"
      className="fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]"
    >
      {text && (
        <p className="flex h-8 items-center justify-center bg-ink px-4 type-caption text-surface">
          <span className="truncate">{text}</span>
        </p>
      )}
      {limited && (
        <p className="flex items-center justify-center bg-surface px-4 py-1 type-caption text-ink shadow-soft">
          Daily database limit reached. It resets at 7 pm Central. Saved data still shows.
        </p>
      )}
      {stale && !failed && (
        <div className="flex items-center justify-between gap-3 bg-surface px-4 type-caption text-ink-muted shadow-soft">
          <span>{stale}</span>
          <button
            className="min-h-11 shrink-0 font-semibold text-sage-700"
            onClick={() => void qc.refetchQueries({ predicate: isRefreshFailed })}
          >
            Retry
          </button>
        </div>
      )}
      {failed && (
        <div className="flex items-center justify-between gap-3 bg-surface px-4 py-1 type-caption text-clay shadow-soft">
          <span>{failed}</span>
          <button className="min-h-11 shrink-0 font-semibold text-sage-700" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {refused.length > 0 && (
        <div className="flex items-start justify-between gap-3 bg-surface px-4 py-2 type-caption text-clay shadow-soft">
          <span>
            Couldn't save {refused.length === 1 ? 'a change' : `${refused.length} changes`} made
            offline. {refused.join(' · ')}
          </span>
          <button
            className="min-h-11 shrink-0 font-semibold text-sage-700"
            onClick={() => setRefused([])}
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}
