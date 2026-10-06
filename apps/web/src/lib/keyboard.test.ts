import { describe, expect, it } from 'vitest';
import { scrollDelta } from './keyboard';

const visible = { top: 0, bottom: 400 };

describe('scrollDelta', () => {
  it('leaves a field that is already clear of the keyboard', () => {
    expect(scrollDelta({ top: 100, bottom: 150 }, visible)).toBe(0);
  });
  it('lifts a field hidden behind the keyboard', () => {
    expect(scrollDelta({ top: 420, bottom: 470 }, visible)).toBe(86);
  });
  it('lifts a field that only touches the keyboard edge', () => {
    expect(scrollDelta({ top: 340, bottom: 395 }, visible)).toBe(11);
  });
  it('brings back a field above the visible top', () => {
    expect(scrollDelta({ top: -30, bottom: 20 }, visible)).toBe(-46);
  });
  it('aligns the top of a field taller than the band', () => {
    expect(scrollDelta({ top: 200, bottom: 700 }, visible)).toBe(184);
  });
});
