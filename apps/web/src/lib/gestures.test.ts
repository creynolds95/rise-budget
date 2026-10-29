import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSelectOnFocus } from './gestures';

describe('installSelectOnFocus', () => {
  installSelectOnFocus();
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const field = (attrs: string, value: string) => {
    document.body.innerHTML = `<input ${attrs} value="${value}" />`;
    return document.querySelector('input') as HTMLInputElement;
  };

  it('selects the whole value of a decimal field on focus', () => {
    vi.useFakeTimers();
    const el = field('inputmode="decimal"', '12.50');
    el.focus();
    vi.runAllTimers();
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 5]);
    vi.useRealTimers();
  });

  it('leaves text fields alone', () => {
    vi.useFakeTimers();
    const el = field('', 'Coffee');
    el.focus();
    el.setSelectionRange(6, 6);
    vi.runAllTimers();
    expect(el.selectionStart).toBe(6);
    vi.useRealTimers();
  });
});
