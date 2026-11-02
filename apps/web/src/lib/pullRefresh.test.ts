import { describe, expect, it } from 'vitest';
import { isArmed, judgePull, PULL_THRESHOLD, pullOffset } from './pullRefresh';

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
