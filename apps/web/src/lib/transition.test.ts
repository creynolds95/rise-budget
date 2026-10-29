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
    root.style.removeProperty('--arrow-shift');
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });
  const setup = (from: string, installed: boolean, wide = false) => {
    vi.useFakeTimers();
    // A phone-width screen, motion allowed.
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('width') && !wide }));
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

  it('slides in place from Dashboard to Surplus in the installed app', () => {
    const { start, navigate } = setup('/', true);
    navigateWithTransition(navigate, '/cash-to-payday', 'forward');
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/cash-to-payday', undefined);
    expect(root.dataset.contentSlide).toBe('forward');
    vi.advanceTimersByTime(400);
    expect(root.dataset.contentSlide).toBeUndefined();
  });

  it('keeps an inert copy of the content being left until the slide ends', () => {
    const { navigate } = setup('/', true);
    const scroller = document.createElement('div');
    scroller.id = 'app-scroll';
    scroller.innerHTML = '<main><p>Dashboard content</p></main>';
    document.body.append(scroller);
    navigateWithTransition(navigate, '/cash-to-payday', 'forward');
    const ghost = document.querySelector<HTMLElement>('.content-ghost');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.textContent).toBe('Dashboard content');
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.content-ghost')).toBeNull();
    scroller.remove();
  });

  it('starts the back arrow at the left edge of the title being left', () => {
    const { navigate } = setup('/', true);
    // Rects from data-left; a bar is on screen unless it is hidden.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const left = Number(this.getAttribute('data-left') ?? 0);
      const height = this.closest('[hidden]') ? 0 : 48;
      return { left, top: 0, height, width: 10 } as DOMRect;
    });
    const dashboard = document.createElement('div');
    dashboard.className = 'banner';
    dashboard.innerHTML = '<span data-bar-title data-left="60">Dashboard</span>';
    const surplus = document.createElement('header');
    surplus.className = 'banner';
    surplus.hidden = true;
    surplus.innerHTML =
      '<a data-transition="back"><svg data-left="17"></svg></a><h1 data-bar-title>Surplus</h1>';
    document.body.append(dashboard, surplus);
    navigate.mockImplementation(() => {
      dashboard.hidden = true;
      surplus.hidden = false;
    });
    navigateWithTransition(navigate, '/cash-to-payday', 'forward');
    expect(root.style.getPropertyValue('--arrow-shift')).toBe('43px');
    vi.advanceTimersByTime(400);
    expect(root.style.getPropertyValue('--arrow-shift')).toBe('');
    dashboard.remove();
    surplus.remove();
  });

  it('slides in place back from Surplus to Dashboard in the installed app', () => {
    const { start, navigate } = setup('/cash-to-payday', true);
    navigateWithTransition(navigate, '/', 'back');
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(root.dataset.contentSlide).toBe('back');
  });

  it('slides every pushed screen in place in the installed app', () => {
    const { start, navigate } = setup('/accounts', true);
    navigateWithTransition(navigate, '/accounts/a1', 'forward');
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/accounts/a1', undefined);
    expect(root.dataset.contentSlide).toBe('forward');
  });

  it('keeps the whole-screen slide on a wide screen in the installed app', () => {
    const { start, navigate } = setup('/', true, true);
    navigateWithTransition(navigate, '/accounts/a1', 'forward');
    expect(start).toHaveBeenCalledOnce();
    expect(root.dataset.contentSlide).toBeUndefined();
  });
});
