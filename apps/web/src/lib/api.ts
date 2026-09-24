/**
 * The API client. The access token lives in memory only (ARCHITECTURE §5); the refresh
 * token is an httpOnly cookie the browser sends to /api/auth. A 401 triggers one refresh,
 * shared by every request waiting on it, then a single retry.
 */
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
let refreshing: Promise<boolean> | null = null;
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

/** Trade the refresh cookie for a new access token. Concurrent callers share one attempt. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        setAccess(null);
        return false;
      }
      setAccess(((await res.json()) as { access: string }).access);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions {
  /** Stable key for a mutation that may be replayed (offline queue). Defaults to a fresh one. */
  idempotencyKey?: string;
}

async function send(method: string, path: string, body: unknown, opts: RequestOptions) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (access) headers['authorization'] = `Bearer ${access}`;
  if (MUTATING.has(method)) headers['idempotency-key'] = opts.idempotencyKey ?? crypto.randomUUID();
  return fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? null : JSON.stringify(body),
  });
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  // The same key on the retry: if the first attempt landed, the server replays it.
  const o = { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() };
  let res = await send(method, path, body, o);
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
