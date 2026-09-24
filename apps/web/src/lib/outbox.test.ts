import { describe, expect, it } from 'vitest';
import { Outbox, isQueueable, memoryStore, type OutboxEntry, type SendResult } from './outbox';

const entry = (key: string, path = `/transactions/${key}`): OutboxEntry => ({
  key,
  method: 'PATCH',
  path,
  body: { reviewState: 'reviewed' },
  label: `file ${key}`,
  queuedAt: '2026-09-24T12:00:00Z',
});

describe('offline outbox (SPEC §10)', () => {
  it('replays in order, once, and empties', async () => {
    const box = new Outbox(memoryStore());
    await box.add(entry('a'));
    await box.add(entry('b'));
    await box.add(entry('a')); // same key → not queued twice
    const seen: string[] = [];
    const r = await box.replay(async (e) => {
      seen.push(e.key);
      return 'ok';
    });
    expect(seen).toEqual(['a', 'b']);
    expect(r).toEqual({ sent: 2, rejected: [] });
    expect(await box.pending()).toEqual([]);
    expect((await box.replay(async () => 'ok')).sent).toBe(0);
  });

  it('stops at the first offline answer, keeping order for next time', async () => {
    const box = new Outbox(memoryStore([entry('a'), entry('b')]));
    const answers: SendResult[] = ['offline'];
    const r = await box.replay(async () => answers.shift() ?? 'ok');
    expect(r.sent).toBe(0);
    expect((await box.pending()).map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('drops and reports what the server will never accept, then carries on', async () => {
    const box = new Outbox(memoryStore([entry('a'), entry('b')]));
    const r = await box.replay(async (e) =>
      e.key === 'a' ? { rejected: 'Unknown category' } : 'ok',
    );
    expect(r.sent).toBe(1);
    expect(r.rejected).toEqual([{ entry: entry('a'), reason: 'Unknown category' }]);
    expect(await box.pending()).toEqual([]);
  });

  it('concurrent replays share one pass, so nothing is sent twice at once', async () => {
    const box = new Outbox(memoryStore([entry('a')]));
    let calls = 0;
    const send = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 'ok' as const;
    };
    await Promise.all([box.replay(send), box.replay(send)]);
    expect(calls).toBe(1);
  });

  it('queues only changes safe to apply late', () => {
    expect(isQueueable('PATCH', '/transactions/abc')).toBe(true);
    expect(isQueueable('POST', '/transactions/abc/splits')).toBe(true);
    expect(isQueueable('POST', '/transactions/bulk-accept')).toBe(true);
    expect(isQueueable('POST', '/accounts/x/snapshots')).toBe(true);
    for (const [m, p] of [
      ['POST', '/periods/2026-08/close'],
      ['POST', '/periods/2026-08/recalculate'],
      ['POST', '/categories/x/forgive'],
      ['POST', '/rules'],
      ['PATCH', '/allocations/2026-09:x'],
      ['POST', '/auth/refresh'],
      ['POST', '/sync/run'],
      ['GET', '/transactions/abc'],
    ] as const) {
      expect(isQueueable(m, p), `${m} ${p}`).toBe(false);
    }
  });
});
