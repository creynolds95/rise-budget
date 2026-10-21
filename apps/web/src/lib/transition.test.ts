import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPushRoute, isTabRoot, navigateWithTransition } from './transition';

describe('isTabRoot', () => {
  it('is true for the four tab landing screens only', () => {
    for (const p of ['/', '/accounts', '/transactions', '/budget', '/budget/', '/budget?m=2026-10'])
      expect(isTabRoot(p)).toBe(true);
    for (const p of ['/accounts/abc', '/settings', '/budget/xyz', '/cash-to-payday'])
      expect(isTabRoot(p)).toBe(false);
  });
});

describe('isPushRoute', () => {
  it('ignores a query or a hash', () => {
    for (const p of ['/review', '/cash-to-payday?x=1', '/cash-to-payday#review'])
      expect(isPushRoute(p)).toBe(true);
  });
});

describe('navigateWithTransition', () => {
  const doc = document as unknown as { startViewTransition?: unknown };
  const root = document.documentElement;
  afterEach(() => {
    delete doc.startViewTransition;
    root.classList.remove('app-full');
    delete root.dataset.contentSlide;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });
  const setup = (from: string, installed: boolean) => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    window.history.replaceState(null, '', from);
    if (installed) root.classList.add('app-full');
    const start = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = start;
    return { start, navigate: vi.fn() };
  };

  it('slides the whole screen in a browser tab', () => {
    const { start, navigate } = setup('/', false);
    navigateWithTransition(navigate, '/cash-to-payday', 'forward');
    expect(start).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/cash-to-payday', undefined);
    expect(root.dataset.contentSlide).toBeUndefined();
  });

  it('slides only the content from Dashboard to Surplus in the installed app', () => {
    const { start, navigate } = setup('/', true);
    navigateWithTransition(navigate, '/cash-to-payday', 'forward');
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/cash-to-payday', undefined);
    expect(root.dataset.contentSlide).toBe('forward');
    vi.advanceTimersByTime(700);
    expect(root.dataset.contentSlide).toBeUndefined();
  });

  it('slides only the content back from Surplus to Dashboard in the installed app', () => {
    const { start, navigate } = setup('/cash-to-payday', true);
    navigateWithTransition(navigate, '/', 'back');
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(root.dataset.contentSlide).toBe('back');
  });

  it('keeps the whole-screen slide for other screens in the installed app', () => {
    const { start, navigate } = setup('/', true);
    navigateWithTransition(navigate, '/accounts/a1', 'forward');
    expect(start).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/accounts/a1', undefined);
    expect(root.dataset.contentSlide).toBeUndefined();
  });
});
