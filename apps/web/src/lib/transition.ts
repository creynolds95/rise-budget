import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router';
import { markBack } from './scrollMemory';

const supportsViewTransitions = () =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides the next screen in (or the current one back out) like a native push/pop
 * (DESIGN-SYSTEM.md §4's depth model), using the browser's View Transitions API where it's
 * supported. Falls back to a plain navigation everywhere else — no fallback code to maintain.
 */
export function navigateWithTransition(
  navigate: NavigateFunction,
  to: string,
  direction: 'forward' | 'back',
) {
  // Going back replaces the screen being left, so the way back never piles up history entries
  // that a later swipe would walk through again.
  const go = () => navigate(to, direction === 'back' ? { replace: true } : undefined);
  if (direction === 'back') markBack(to);
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    go();
    return;
  }
  document.documentElement.dataset.pageTransition = direction;
  const transition = document.startViewTransition(() => flushSync(go));
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.pageTransition;
  });
}

/** True for routes that push a new screen, not a lateral tab switch (table.ts's depth-1/2). */
export function isPushRoute(to: string): boolean {
  const path = to.split(/[?#]/)[0] ?? '';
  return (
    /^\/(accounts|transactions|budget)\/[^/]+/.test(path) ||
    /^\/(review|cash-to-payday)\/?$/.test(path) ||
    /^\/settings\/[^/]+/.test(path)
  );
}

/** A click handler for a `<Link to={to}>` that pushes/pops with a transition on a plain click. */
export function transitionClick(
  navigate: NavigateFunction,
  to: string,
  direction: 'forward' | 'back' = 'forward',
) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    navigateWithTransition(navigate, to, direction);
  };
}

/** The four tab landing screens: nothing is "behind" them. */
export function isTabRoot(path: string): boolean {
  return /^\/(accounts|transactions|budget)?\/?$/.test(path.split('?')[0] ?? '');
}
