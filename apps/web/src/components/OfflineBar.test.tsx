import { QueryClient, type Query } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { isStuck } from './OfflineBar';

async function failing(meta: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const opts = {
    queryKey: ['x'] as readonly unknown[],
    queryFn: () => Promise.reject<unknown>(new Error('boom')),
    meta,
  };
  const observer = qc.getQueryCache().build(qc, opts);
  const unsub = qc.getQueryCache().subscribe(() => {});
  await qc.prefetchQuery(opts);
  // An on-screen reader.
  observer.addObserver({ options: opts } as never);
  unsub();
  return observer as unknown as Query;
}

describe('isStuck', () => {
  it('counts a failed on-screen read with nothing cached', async () => {
    expect(isStuck(await failing())).toBe(true);
  });
  it('ignores a failed optional read: the screen renders without it', async () => {
    expect(isStuck(await failing({ optional: true }))).toBe(false);
  });
});
