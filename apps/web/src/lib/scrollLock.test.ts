import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockScroll } from './scrollLock';

describe('lockScroll', () => {
  afterEach(() => document.body.removeAttribute('style'));

  it('pins the body at the current offset and restores it on release', () => {
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const release = lockScroll();
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-240px');
    // Keeps the box reaching the screen bottom, so the tab bar doesn't rise by the offset.
    expect(document.body.getAttribute('style')).toContain('min-height: calc(100dvh + 240px)');
    release();
    expect(document.body.getAttribute('style')).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it('stays locked until the last of nested locks releases', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const outer = lockScroll();
    const inner = lockScroll();
    inner();
    inner();
    expect(document.body.style.position).toBe('fixed');
    outer();
    expect(document.body.style.position).toBe('');
  });
});
