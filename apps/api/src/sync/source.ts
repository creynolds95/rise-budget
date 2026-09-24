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
  return {
    mode: 'live',
    async fetchAccounts(startDate) {
      let res: Response;
      try {
        res = await fetcher(`${base}/accounts?start-date=${startDate}&pending=1`, {
          headers: { authorization: auth },
        });
      } catch {
        throw new SourceError('Could not reach SimpleFIN');
      }
      if (res.status === 403) throw new SourceError('SimpleFIN refused the access URL (403)');
      if (!res.ok) throw new SourceError(`SimpleFIN returned ${res.status}`);
      try {
        return await res.json();
      } catch {
        throw new SourceError('SimpleFIN returned invalid JSON');
      }
    },
  };
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
