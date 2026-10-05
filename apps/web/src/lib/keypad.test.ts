import { describe, expect, it } from 'vitest';
import { pressKey } from './keypad';

describe('pressKey', () => {
  it('replaces a selected amount with the first digit, then appends', () => {
    expect(pressKey('36', '5', true)).toBe('5');
    expect(pressKey('5', '0', false)).toBe('50');
  });
  it('clears a selected amount on delete, otherwise drops one character', () => {
    expect(pressKey('36', 'back', true)).toBe('');
    expect(pressKey('36', 'back', false)).toBe('3');
    expect(pressKey('', 'back', false)).toBe('');
  });
  it('allows one decimal point and two places', () => {
    expect(pressKey('', '.', false)).toBe('0.');
    expect(pressKey('36', '.', true)).toBe('0.');
    expect(pressKey('3.5', '.', false)).toBe('3.5');
    expect(pressKey('3.5', '0', false)).toBe('3.50');
    expect(pressKey('3.50', '1', false)).toBe('3.50');
  });
  it('drops a leading zero and caps whole dollars at seven digits', () => {
    expect(pressKey('0', '7', false)).toBe('7');
    expect(pressKey('1234567', '8', false)).toBe('1234567');
  });
});
