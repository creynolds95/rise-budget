import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLLER_ID, onScroll, scroller, scrollToY, scrollTop } from './scroller';

const mount = (overflowY: string) => {
  const el = document.createElement('div');
  el.id = SCROLLER_ID;
  el.style.overflowY = overflowY;
  document.body.append(el);
  return el;
};

afterEach(() => {
  document.getElementById(SCROLLER_ID)?.remove();
  vi.restoreAllMocks();
});

describe('scroller', () => {
  it('is the window that scrolls when the container does not (desktop)', () => {
    mount('visible');
    expect(scroller()).toBeNull();
  });

  it('is the container when it scrolls (phone), including while a sheet freezes it', () => {
    const el = mount('auto');
    expect(scroller()).toBe(el);
    el.style.overflowY = 'hidden';
    expect(scroller()).toBe(el);
  });

  it('reads and moves the container on a phone, the window otherwise', () => {
    const el = mount('auto');
    el.scrollTo = vi.fn() as never;
    Object.defineProperty(el, 'scrollTop', { value: 120, configurable: true });
    expect(scrollTop()).toBe(120);
    scrollToY(40, 'smooth');
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'smooth' });

    el.style.overflowY = 'visible';
    const win = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    scrollToY(7);
    expect(win).toHaveBeenCalledWith(0, 7);
  });

  it('listens to both, and stops listening to both', () => {
    const el = mount('auto');
    const fn = vi.fn();
    const off = onScroll(fn);
    el.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    el.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
