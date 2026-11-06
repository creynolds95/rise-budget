import { describe, expect, it } from 'vitest';
import {
  isArmed,
  judgePull,
  PULL_THRESHOLD,
  pullOffset,
  SYNC_EVERY_MS,
  dailyRoom,
  syncDue,
} from './pullRefresh';

describe('judgePull', () => {
  it('waits until the finger has moved', () => {
    expect(judgePull(2, 3)).toBe('undecided');
  });
  it('pulls on a clear downward drag', () => {
    expect(judgePull(3, 20)).toBe('pull');
  });
  it('ignores a sideways drag (menu / swipe back)', () => {
    expect(judgePull(40, 12)).toBe('ignore');
    expect(judgePull(20, 20)).toBe('ignore');
  });
  it('ignores an upward drag', () => {
    expect(judgePull(0, -30)).toBe('ignore');
  });
});

describe('pull distance', () => {
  it('resists and caps the indicator travel', () => {
    expect(pullOffset(-5)).toBe(0);
    expect(pullOffset(100)).toBeLessThan(100);
    expect(pullOffset(1000)).toBe(120);
  });
  it('arms at the threshold', () => {
    expect(isArmed(PULL_THRESHOLD - 1)).toBe(false);
    expect(isArmed(PULL_THRESHOLD)).toBe(true);
  });
});

describe('syncDue', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('is due when nothing has synced', () => expect(syncDue(now, null, undefined)).toBe(true));
  it('is not due within the hour', () => {
    expect(syncDue(now, now - SYNC_EVERY_MS + 1000)).toBe(false);
    expect(syncDue(now, '2026-11-01T11:30:00Z')).toBe(false);
  });
  it('uses the newest of several sources', () => {
    expect(syncDue(now, '2026-11-01T09:00:00Z', now - 60_000)).toBe(false);
  });
  it('is due at exactly an hour', () => expect(syncDue(now, now - SYNC_EVERY_MS)).toBe(true));
});

describe('dailyRoom', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('leaves the schedule its share', () => {
    const recent = Array.from({ length: 8 }, (_, i) =>
      new Date(now - (i + 1) * 3_600_000).toISOString(),
    );
    expect(dailyRoom(now, recent.slice(0, 7))).toBe(true);
    expect(dailyRoom(now, recent)).toBe(false);
  });
  it('ignores runs older than a day', () => {
    expect(dailyRoom(now, Array(10).fill('2026-10-30T00:00:00Z'))).toBe(true);
  });
});
