import { describe, expect, it } from 'vitest';
import { DEFAULT_TILES, tileOrder } from './dashboard';

describe('dashboard tiles', () => {
  it('keeps the stock layout until customized, new tiles hidden', () => {
    const { all, shown } = tileOrder(null);
    expect([...shown]).toEqual([...DEFAULT_TILES]);
    expect(all.slice(0, DEFAULT_TILES.length)).toEqual([...DEFAULT_TILES]);
    expect(all).toContain('retirement');
    expect(shown.has('retirement')).toBe(false);
  });

  it('shows saved tiles in their saved order and lists the rest after', () => {
    const { all, shown } = tileOrder(['retirement', 'budget']);
    expect(all.slice(0, 2)).toEqual(['retirement', 'budget']);
    expect(new Set(all).size).toBe(all.length);
    expect(shown.has('surplus')).toBe(false);
  });
});
