import { afterEach, describe, expect, it } from 'vitest';
import { lockScroll } from './scrollLock';

const touchMove = (target: Element) => {
  const e = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: [{}] });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('lockScroll', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.innerHTML = '';
  });

  it('freezes the page without moving the body, and restores on release', () => {
    const release = lockScroll();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    // position:fixed on <body> is what lifted the tab bar on iPhone
    expect(document.body.style.position).toBe('');
    release();
    release();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked until the last of nested locks releases', () => {
    const outer = lockScroll();
    const inner = lockScroll();
    inner();
    expect(document.body.style.overflow).toBe('hidden');
    outer();
    expect(document.body.style.overflow).toBe('');
  });

  it('cancels touch moves over the page but not inside a scrollable sheet', () => {
    const page = document.createElement('div');
    const sheet = document.createElement('div');
    const child = document.createElement('span');
    sheet.style.overflowY = 'auto';
    Object.defineProperty(sheet, 'scrollHeight', { value: 500 });
    Object.defineProperty(sheet, 'clientHeight', { value: 200 });
    sheet.append(child);
    document.body.append(page, sheet);
    const release = lockScroll();
    expect(touchMove(page)).toBe(true);
    expect(touchMove(child)).toBe(false);
    release();
    expect(touchMove(page)).toBe(false);
  });
});
