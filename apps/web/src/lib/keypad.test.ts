import { describe, expect, it } from 'vitest';
import { pressKey } from './keypad';

describe('pressKey', () => {
  it('replaces a selected amount with the first digit, then appends', () => {
    expect(pressKey('36', '5', true)).toBe('5');
    expect(pressKey('5', '0', false)).toBe('50');
  });
  it('clears a selected amount on delete, otherwise drops one digit', () => {
    expect(pressKey('36', 'back', true)).toBe('');
    expect(pressKey('36', 'back', false)).toBe('3');
    expect(pressKey('', 'back', false)).toBe('');
  });
  it('drops a leading zero and caps at seven digits', () => {
    expect(pressKey('0', '7', false)).toBe('7');
    expect(pressKey('1234567', '8', false)).toBe('1234567');
  });
});
