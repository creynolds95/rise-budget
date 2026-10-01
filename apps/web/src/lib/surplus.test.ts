import { describe, expect, it } from 'vitest';
import { axisPicks, surplusTone } from './surplus';

describe('surplus', () => {
  it('green above zero, clay below, ink at zero', () => {
    expect(surplusTone(1)).toBe('in');
    expect(surplusTone(-1)).toBe('over');
    expect(surplusTone(0)).toBe('ink');
  });
  it('axis labels never crowd', () => {
    expect(axisPicks(3)).toEqual([0, 1, 2]);
    expect(axisPicks(10)).toEqual([0, 3, 6, 9]);
  });
});
