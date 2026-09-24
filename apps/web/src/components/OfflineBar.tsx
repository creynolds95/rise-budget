import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import {
  isOnline,
  onConnectivityChange,
  onOutboxChange,
  outbox,
  probe,
  replayOutbox,
} from '../lib/api';
import type { OutboxEntry } from '../lib/outbox';

export function useOnline(): boolean {
  return useSyncExternalStore(onConnectivityChange, isOnline, () => true);
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
  const show = text !== null || refused.length > 0;

  // Sticky headers sit below the bar rather than under it.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--banner-h', show ? '32px' : '0px');
  }, [show]);

  if (!show) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]">
      {text && (
        <p className="flex h-8 items-center justify-center bg-ink px-4 type-caption text-surface">
          <span className="truncate">{text}</span>
        </p>
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
