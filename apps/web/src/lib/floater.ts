import { useSyncExternalStore } from 'react';

/** One message floating above the tab bar: a sync in progress, then its result. */
export interface FloaterMessage {
  id: number;
  text: string;
  tone: 'ok' | 'warn';
  busy: boolean;
  leaving: boolean;
}

const FADE_MS = 220;
let current: FloaterMessage | null = null;
let seq = 0;
let timers: number[] = [];
const listeners = new Set<() => void>();

const set = (m: FloaterMessage | null) => {
  current = m;
  listeners.forEach((l) => l());
};
const clearTimers = () => {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
};

/** Fades the floater out. */
export function hideFloater() {
  clearTimers();
  if (!current) return;
  const id = current.id;
  set({ ...current, leaving: true });
  timers.push(window.setTimeout(() => current?.id === id && set(null), FADE_MS));
}

/** Shows a message, replacing any other; with `ttlMs` it fades out on its own. */
export function showFloater(m: {
  text: string;
  tone?: 'ok' | 'warn';
  busy?: boolean;
  ttlMs?: number | undefined;
}) {
  clearTimers();
  set({ id: ++seq, text: m.text, tone: m.tone ?? 'ok', busy: m.busy ?? false, leaving: false });
  if (m.ttlMs) timers.push(window.setTimeout(hideFloater, m.ttlMs));
}

export function useFloater(): FloaterMessage | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
