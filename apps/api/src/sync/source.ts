import type { Env } from '../env';
import { mockSimpleFin } from './mock';

/**
 * Where SimpleFIN data comes from. The sync never knows which one it has, so the mock can
 * be swapped for the real bridge by setting one secret.
 */
export interface SimpleFinSource {
  readonly mode: 'live' | 'mock';
  /** Raw `/accounts` JSON for transactions posted on or after `startDate` (unix seconds). */
  fetchAccounts(startDate: number): Promise<unknown>;
  /** Response headers of the last fetch that mattered for freshness, when there was one. */
  lastFetch?: FetchInfo;
}

export interface FetchInfo {
  status: number;
  date: string | null;
  age: string | null;
  cacheStatus: string | null;
}

export class SourceError extends Error {
  override readonly name = 'SourceError';
}

/**
 * The real bridge. The access URL carries Basic credentials in its userinfo; they move to an
 * Authorization header and never appear in an error message or log.
 */
export function httpSimpleFin(accessUrl: string, fetcher: typeof fetch = fetch): SimpleFinSource {
  const url = new URL(accessUrl);
  const auth = `Basic ${btoa(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`)}`;
  url.username = '';
  url.password = '';
  const base = url.toString().replace(/\/$/, '');
  const source: SimpleFinSource = {
    mode: 'live',
    async fetchAccounts(startDate) {
      let res: Response;
      try {
        // Never a cached answer: a stale copy would look exactly like a bank that hasn't posted.
        res = await fetcher(`${base}/accounts?start-date=${startDate}&pending=1`, {
          headers: { authorization: auth, 'cache-control': 'no-cache' },
          cache: 'no-store',
        });
      } catch {
        throw new SourceError('Could not reach SimpleFIN');
      }
      source.lastFetch = {
        status: res.status,
        date: res.headers.get('date'),
        age: res.headers.get('age'),
        cacheStatus: res.headers.get('cf-cache-status'),
      };
      if (res.status === 403) throw new SourceError('SimpleFIN refused the access URL (403)');
      if (!res.ok) throw new SourceError(`SimpleFIN returned ${res.status}`);
      try {
        return await res.json();
      } catch {
        throw new SourceError('SimpleFIN returned invalid JSON');
      }
    },
  };
  return source;
}

/**
 * Live when the access URL secret exists; mock only when explicitly asked for (local dev).
 * Production without the secret has no source — it never falls back to fake data.
 */
export function sourceFromEnv(
  env: Env,
  now: () => Date = () => new Date(),
): SimpleFinSource | null {
  if (env.SIMPLEFIN_ACCESS_URL) return httpSimpleFin(env.SIMPLEFIN_ACCESS_URL);
  if (env.SIMPLEFIN_MOCK === '1') return mockSimpleFin(now);
  return null;
}
