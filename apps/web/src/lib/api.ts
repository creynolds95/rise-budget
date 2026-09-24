/**
 * The API client. The access token lives in memory only (ARCHITECTURE §5); the refresh
 * token is an httpOnly cookie the browser sends to /api/auth. A 401 triggers one refresh,
 * shared by every request waiting on it, then a single retry.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { Outbox, isQueueable, type OutboxEntry, type SendResult } from './outbox';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

let access: string | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setAccess(token: string | null) {
  access = token;
  for (const fn of listeners) fn(token !== null);
}

export const hasAccess = () => access !== null;

export type RefreshResult = 'ok' | 'denied' | 'offline';
let refreshingState: Promise<RefreshResult> | null = null;

/**
 * Trade the refresh cookie for a new access token. Concurrent callers share one attempt.
 * 'offline' means the server couldn't be reached — not that the session is gone.
 */
export function refreshSession(): Promise<RefreshResult> {
  refreshingState ??= (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      reachable(true);
      if (res.status >= 500) return 'offline';
      if (!res.ok) {
        setAccess(null);
        return 'denied';
      }
      setAccess(((await res.json()) as { access: string }).access);
      return 'ok';
    } catch {
      reachable(false);
      return 'offline';
    } finally {
      refreshingState = null;
    }
  })();
  return refreshingState;
}

export const refresh = async () => (await refreshSession()) === 'ok';

// ── connectivity ─────────────────────────────────────────────────────────────

let lastReachable = true;
const netListeners = new Set<() => void>();

/** Record whether the last request reached the server. Airplane mode and lie-fi alike. */
function reachable(ok: boolean) {
  if (ok === lastReachable) return;
  lastReachable = ok;
  for (const fn of netListeners) fn();
}

export const isOnline = () =>
  lastReachable && (typeof navigator === 'undefined' || navigator.onLine !== false);

/** Ask the server directly whether it's reachable; the answer updates isOnline(). */
export async function probe(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    reachable(res.ok);
    return res.ok;
  } catch {
    reachable(false);
    return false;
  }
}

export function onConnectivityChange(fn: () => void): () => void {
  netListeners.add(fn);
  const both = () => fn();
  window.addEventListener('online', both);
  window.addEventListener('offline', both);
  return () => {
    netListeners.delete(fn);
    window.removeEventListener('online', both);
    window.removeEventListener('offline', both);
  };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions {
  /** Stable key for a mutation that may be replayed (offline queue). Defaults to a fresh one. */
  idempotencyKey?: string;
  /** What the change is, in the person's words, if it has to wait in the offline queue. */
  label?: string;
  /** H4: proof of a just-now passkey re-verification, for a route that requires it. */
  stepUp?: string;
}

/** A change that couldn't reach the server was kept on the device and will send later. */
export const QUEUED_OFFLINE = 'QUEUED_OFFLINE';
export const isQueuedOffline = (e: unknown) => e instanceof ApiError && e.code === QUEUED_OFFLINE;

async function send(method: string, path: string, body: unknown, opts: RequestOptions) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (access) headers['authorization'] = `Bearer ${access}`;
  if (opts.stepUp) headers['x-step-up'] = opts.stepUp;
  if (MUTATING.has(method)) headers['idempotency-key'] = opts.idempotencyKey ?? crypto.randomUUID();
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? null : JSON.stringify(body),
    });
    reachable(true);
    return res;
  } catch (e) {
    reachable(false);
    throw e;
  }
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  // The same key on the retry: if the first attempt landed, the server replays it.
  const o = { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() };
  let res: Response;
  try {
    res = await send(method, path, body, o);
  } catch (e) {
    if (MUTATING.has(method) && isQueueable(method, path)) {
      await outbox.add({
        key: o.idempotencyKey,
        method,
        path,
        body,
        label: opts.label ?? 'A change',
        queuedAt: new Date().toISOString(),
      });
      notifyOutbox();
      throw new ApiError(
        0,
        QUEUED_OFFLINE,
        "Saved on this device. It sends when you're back online.",
      );
    }
    throw new ApiError(0, 'OFFLINE', "Can't reach Rise right now. Check your connection.", e);
  }
  if (res.status === 401 && !path.startsWith('/auth/') && (await refresh())) {
    res = await send(method, path, body, o);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; detail?: unknown } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? res.statusText,
      err?.detail,
    );
  }
  return json as T;
}

export const get = <T>(path: string) => api<T>('GET', path);

/**
 * T46: hands the browser a file to save, reusing `send`'s auth and the one-retry-on-401
 * that `api` does. Export needs the raw body and its filename, not a JSON-parsed result.
 */
export async function downloadExport(format: 'json' | 'csv'): Promise<void> {
  const path = `/export?format=${format}`;
  let res = await send('GET', path, undefined, {});
  if (res.status === 401 && (await refresh())) res = await send('GET', path, undefined, {});
  if (!res.ok) throw new ApiError(res.status, 'UNKNOWN', 'Could not export your data');
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `rise-export.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── offline outbox ───────────────────────────────────────────────────────────

const OUTBOX_KEY = 'rise-outbox';
export const outbox = new Outbox({
  load: async () => (await idbGet<OutboxEntry[]>(OUTBOX_KEY)) ?? [],
  save: (entries) => idbSet(OUTBOX_KEY, entries),
});

const outboxListeners = new Set<() => void>();
export function onOutboxChange(fn: () => void): () => void {
  outboxListeners.add(fn);
  return () => outboxListeners.delete(fn);
}
function notifyOutbox() {
  for (const fn of outboxListeners) fn();
}

/** Replay one queued change with its original key; the server applies it at most once. */
async function sendQueued(e: OutboxEntry): Promise<SendResult> {
  let res: Response;
  try {
    res = await send(e.method, e.path, e.body, { idempotencyKey: e.key });
    if (res.status === 401) {
      const r = await refreshSession();
      if (r !== 'ok') return 'offline';
      res = await send(e.method, e.path, e.body, { idempotencyKey: e.key });
    }
  } catch {
    return 'offline';
  }
  if (res.ok) return 'ok';
  if (res.status >= 500) return 'offline';
  const err = (
    (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  )?.error;
  // 409 with this code: the first send is still being applied. Try again next pass.
  if (res.status === 409 && err?.code === 'IDEMPOTENCY_CONFLICT') return 'offline';
  return { rejected: err?.message ?? res.statusText };
}

export async function replayOutbox() {
  const r = await outbox.replay(sendQueued);
  if (r.sent || r.rejected.length) notifyOutbox();
  return r;
}
