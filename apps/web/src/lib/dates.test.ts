import { describe, expect, it } from 'vitest';
import { monthEnd } from './dates';

describe('monthEnd', () => {
  it('is the real last day, never a made-up 31st', () => {
    expect(monthEnd('2026-09')).toBe('2026-09-30');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});
