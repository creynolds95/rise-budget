import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isPushRoute, isTabRoot, navigateWithTransition } from './transition';

/**
 * The app is a fixed-scale page: nothing zooms by pinch or double-tap. Charts that want to
 * be enlarged mark themselves `data-zoomable` and handle their own gestures.
 */
export function installNoZoom() {
  const block = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('[data-zoomable]')) return;
    e.preventDefault();
  };
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, block, { passive: false });
  }
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) block(e);
    },
    { passive: false },
  );
}

/** Width of the screen edge where iOS starts its own back gesture. */
const EDGE = 20;

/**
 * iOS starts its own slide-back from the left edge and shows the previous screen, which in
 * an installed app is whatever the history holds. Cancelling a touch that begins in the
 * edge strip stops that; screens that go back do so with `useSwipeBack` instead. A tap that
 * lands in the strip is re-sent as a click, since cancelling the touch suppresses it.
 */
export function installEdgeGuard() {
  let tap: { x: number; y: number; el: Element } | null = null;
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      const el = e.target as Element | null;
      tap = null;
      if (!t || e.touches.length !== 1 || t.clientX > EDGE || !el) return;
      if (el.closest('[data-zoomable], input, textarea, select')) return;
      tap = { x: t.clientX, y: t.clientY, el };
      e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      const start = tap;
      tap = null;
      if (!start || !t) return;
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return;
      const target = start.el.closest('a, button, [role=button]') ?? start.el;
      (target as HTMLElement).click?.();
    },
    { passive: true },
  );
}

/** Where in the page a link points, or null for anything that leaves the app. */
function internalPath(a: HTMLAnchorElement): string | null {
  if (a.target && a.target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  const u = new URL(a.href, window.location.href);
  if (u.origin !== window.location.origin) return null;
  return u.pathname + u.search + u.hash;
}

/**
 * Every in-app link that opens a deeper screen slides in from the side, and the way back
 * slides out — decided here once, not per link, so a new screen can't forget to.
 */
export function useLinkTransitions() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = internalPath(a);
      if (!to) return;
      const here = window.location.pathname;
      // A back link says so: going back to a deeper screen (Categories → Budget settings) is
      // still a pop, though its target is a push route.
      const direction =
        a.dataset['transition'] === 'back'
          ? 'back'
          : isPushRoute(to)
            ? 'forward'
            : isPushRoute(here)
              ? 'back'
              : null;
      if (!direction) return;
      e.preventDefault();
      navigateWithTransition(navigate, to, direction);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
}

/**
 * Swipe right from the left part of the screen to go back, on a screen that slid in from
 * the side. The edge strip is included: `installEdgeGuard` keeps iOS's own gesture out of it.
 */
export function useSwipeBack(to: string | null) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!to) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const el = e.target as Element | null;
      start =
        e.touches.length === 1 &&
        t &&
        t.clientX < window.innerWidth * 0.4 &&
        !el?.closest('[data-zoomable], [data-no-swipe], input, textarea, [role=dialog]')
          ? { x: t.clientX, y: t.clientY }
          : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      start = null;
      if (dx > 80 && dx > dy * 2) navigateWithTransition(navigate, to, 'back');
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [navigate, to]);
}

/**
 * On a tab's landing screen a back gesture (or browser back) does nothing. Whatever history
 * sits behind it, a copy of the screen is put there so back lands on itself, and every
 * landing back on a tab screen puts the copy back.
 */
export function useTabRootTrap(pathname: string) {
  useEffect(() => {
    if (!isTabRoot(pathname)) return;
    const trap = () => {
      if (isTabRoot(window.location.pathname)) {
        window.history.pushState(window.history.state, '', window.location.href);
      }
    };
    trap();
    window.addEventListener('popstate', trap);
    return () => window.removeEventListener('popstate', trap);
  }, [pathname]);
}
