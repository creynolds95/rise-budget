import { clientRoute } from '@rise/shared/activity';

/**
 * Lightweight client-side timings for the diagnostics log: per route pattern, how many calls,
 * how many failed and how long they took, plus uncaught script errors and the app's load time.
 * Batched in memory and sent at most every few minutes (and when the app is hidden); a failed
 * send just drops the batch. Nothing here records URLs with ids, bodies or any user content.
 */

interface Sample {
  n: number;
  errors: number;
  msTotal: number;
  msMax: number;
}

const FLUSH_MS = 5 * 60_000;
const buffer = new Map<string, Sample>();
let sender: ((samples: unknown[]) => Promise<unknown>) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function record(route: string, ms: number, failed: boolean) {
  const s = buffer.get(route) ?? { n: 0, errors: 0, msTotal: 0, msMax: 0 };
  s.n++;
  if (failed) s.errors++;
  s.msTotal += Math.round(ms);
  s.msMax = Math.max(s.msMax, Math.round(ms));
  buffer.set(route, s);
  if (buffer.size > 40) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Time one API call. `path` is the request path; it is reduced to a route pattern. */
export function recordApi(method: string, path: string, started: number, failed: boolean) {
  if (path.startsWith('/diagnostics/client')) return;
  record(`${method} ${clientRoute(path)}`, performance.now() - started, failed);
}

export async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!sender || buffer.size === 0) return;
  const samples = [...buffer].map(([route, s]) => ({ route, ...s })).slice(0, 40);
  buffer.clear();
  try {
    await sender(samples);
  } catch {
    // Diagnostics are best-effort.
  }
}

/** Wire the reporter once at startup. `send` posts the batch (with auth) to the API. */
export function startPerfReporting(send: (samples: unknown[]) => Promise<unknown>) {
  sender = send;
  window.addEventListener('error', () => record('js error', 0, true));
  window.addEventListener('unhandledrejection', () => record('js unhandled rejection', 0, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('load', () => {
    // After the load event settles, so loadEventEnd is filled in.
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      if (nav && nav.loadEventEnd > 0) record('app load', nav.loadEventEnd, false);
    }, 0);
  });
}
