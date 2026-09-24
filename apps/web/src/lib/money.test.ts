import { describe, expect, it } from 'vitest';
import { MINUS, centsToInput, formatCents, parseMoney } from './money';

describe('formatCents', () => {
  it('formats integer cents with grouping and a true minus', () => {
    expect(formatCents(123_456)).toBe('$1,234.56');
    expect(formatCents(-9_300)).toBe(`${MINUS}$93.00`);
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(100_000_000_00)).toBe('$100,000,000.00');
  });
  it('whole dollars round half away from zero', () => {
    expect(formatCents(-9_350, { whole: true })).toBe(`${MINUS}$94`);
    expect(formatCents(9_349, { whole: true })).toBe('$93');
    expect(formatCents(-49, { whole: true })).toBe('$0');
  });
  it('sign modes', () => {
    expect(formatCents(4_000, { sign: 'always' })).toBe('+$40.00');
    expect(formatCents(-4_000, { sign: 'never' })).toBe('$40.00');
    expect(formatCents(0, { sign: 'always' })).toBe('$0.00');
  });
  it('refuses floats', () => {
    expect(() => formatCents(1.5)).toThrow(TypeError);
  });
});

describe('parseMoney', () => {
  it.each([
    ['250', 25_000],
    ['$1,234.5', 123_450],
    ['.5', 50],
    ['-3.20', -320],
    [`${MINUS}3`, -300],
    ['0', 0],
    ['-0', 0],
    [' 12.34 ', 1_234],
  ])('%s → %i', (input, cents) => expect(parseMoney(input)).toBe(cents));

  it.each(['', '.', 'abc', '1.234', '1e3', '--1', '99999999999999999'])('rejects %s', (input) =>
    expect(parseMoney(input)).toBeNull(),
  );

  it('round-trips through the edit string', () => {
    for (const c of [0, 5, 25_000, -9_350, 123_456]) expect(parseMoney(centsToInput(c))).toBe(c);
  });
});
