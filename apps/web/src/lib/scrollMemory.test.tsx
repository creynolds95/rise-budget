import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { lockScroll } from './scrollLock';
import { useScrollMemory } from './scrollMemory';
import { navigateWithTransition } from './transition';

let nav: NavigateFunction;
function Probe() {
  useScrollMemory();
  nav = useNavigate();
  return null;
}

let y = 0;
const scrollTo = vi.fn((_x: number, top: number) => {
  y = top;
});

function scrollBy(top: number) {
  y = top;
  window.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  y = 0;
  scrollTo.mockClear();
  Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as never);
  render(
    <MemoryRouter initialEntries={['/transactions']}>
      <Probe />
    </MemoryRouter>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('useScrollMemory', () => {
  it('opens a detail page at the top, whatever the list was scrolled to', () => {
    scrollBy(1200);
    act(() => void nav('/transactions/t1'));
    expect(y).toBe(0);
  });

  it('puts the list back where it was on the in-app way back', () => {
    scrollBy(1200);
    act(() => void nav('/transactions/t1'));
    scrollBy(300);
    act(() => navigateWithTransition(nav, '/transactions', 'back'));
    expect(y).toBe(1200);
  });

  it('puts the list back on a browser back (pop)', () => {
    scrollBy(800);
    act(() => void nav('/accounts/a1'));
    act(() => void nav(-1));
    expect(y).toBe(800);
  });

  it('starts another tab at the top', () => {
    scrollBy(500);
    act(() => void nav('/budget', { replace: true }));
    expect(y).toBe(0);
  });

  it('ignores the zero a sheet reads while it pins the page', () => {
    scrollBy(900);
    const release = lockScroll();
    scrollBy(0);
    release();
    act(() => void nav('/transactions/t1'));
    act(() => navigateWithTransition(nav, '/transactions', 'back'));
    expect(y).toBe(900);
  });
});
