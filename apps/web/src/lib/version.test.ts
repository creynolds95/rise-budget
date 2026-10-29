import { describe, expect, it } from 'vitest';
import { isStale } from './version';

describe('isStale', () => {
  const a = { version: '2026-10-04T17:00:00.000Z', commit: 'abc1234' };
  it('is false for the same build', () => expect(isStale(a, { ...a })).toBe(false));
  it('is true for a new commit', () => expect(isStale(a, { ...a, commit: 'def5678' })).toBe(true));
  it('is true for a rebuild of the same commit', () =>
    expect(isStale(a, { ...a, version: '2026-10-04T18:00:00.000Z' })).toBe(true));
});
