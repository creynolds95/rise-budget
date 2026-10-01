import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem } from './reorder';

const tops = [0, 50, 100, 150];
const heights = [50, 50, 50, 50];

describe('reordering', () => {
  it('moves an item without touching the original', () => {
    const a = ['a', 'b', 'c'];
    expect(moveItem(a, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(a, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(a).toEqual(['a', 'b', 'c']);
    expect(moveItem(a, 5, 0)).toEqual(['a', 'b', 'c']);
  });
  it('lands where the dragged row’s centre has crossed the others’', () => {
    expect(dropIndex(tops, heights, 1, 0)).toBe(1);
    expect(dropIndex(tops, heights, 1, 20)).toBe(1);
    expect(dropIndex(tops, heights, 1, 60)).toBe(2);
    expect(dropIndex(tops, heights, 1, 120)).toBe(3);
    expect(dropIndex(tops, heights, 2, -60)).toBe(1);
    expect(dropIndex(tops, heights, 3, -999)).toBe(0);
    expect(dropIndex(tops, heights, 0, 999)).toBe(3);
  });
});
