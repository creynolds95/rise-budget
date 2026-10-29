import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { isScrollLocked } from './scrollLock';
import { onScroll, scrollToY, scrollTop } from './scroller';

/**
 * Each screen's last scroll offset, by path. Going back to a screen puts it where it was;
 * any other arrival starts at the top, so a detail page never opens partway down because the
 * list before it was scrolled.
 */
const offsets = new Map<string, number>();
let backTo: string | null = null;

const pathOf = (to: string) => to.split(/[?#]/)[0] || '/';

/** Called by the in-app way back (back arrow, swipe), which navigates by replace, not pop. */
export function markBack(to: string) {
  backTo = pathOf(to);
}

/** How long a restore keeps waiting for the page to grow tall enough (data loading in). */
const SETTLE_MS = 1500;

export function useScrollMemory() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const current = useRef(pathname);
  const pop = useRef(navType === 'POP');
  pop.current = navType === 'POP';

  useEffect(() => {
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    // A sheet pins the body, which reads as offset 0; that isn't where the page is.
    const stop = onScroll(() => {
      if (!isScrollLocked()) offsets.set(current.current, scrollTop());
    });
    return () => {
      stop();
      window.history.scrollRestoration = prev;
    };
  }, []);

  useLayoutEffect(() => {
    current.current = pathname;
    const back = pop.current || backTo === pathname;
    backTo = null;
    const target = back ? (offsets.get(pathname) ?? 0) : 0;
    scrollToY(target);
    if (target === 0) return;
    // The list may still be loading or re-rendering; keep putting it back until it holds,
    // unless the user starts scrolling first.
    let frame = 0;
    const deadline = performance.now() + SETTLE_MS;
    const stop = () => cancelAnimationFrame(frame);
    const tick = () => {
      if (Math.abs(scrollTop() - target) > 1) scrollToY(target);
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
      else cleanup();
    };
    const events = ['touchstart', 'wheel', 'keydown'] as const;
    const cleanup = () => {
      stop();
      for (const e of events) window.removeEventListener(e, cleanup);
    };
    for (const e of events) window.addEventListener(e, cleanup, { passive: true });
    frame = requestAnimationFrame(tick);
    return cleanup;
  }, [pathname]);
}
