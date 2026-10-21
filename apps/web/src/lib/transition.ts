import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router';
import { markBack } from './scrollMemory';
import { SCROLLER_ID } from './scroller';

const supportsViewTransitions = () =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Trial in the installed app (boot.js), Dashboard <-> Surplus only: while a view transition runs,
// iOS 26 sees a snapshot instead of the sticky title bar and fades the status bar until it ends.
// Here nothing is a snapshot. The content moves as the view transition moved it, with an inert
// copy standing in for the screen being left; the green bar stays live, its buttons fade and
// only its title slides (styles.css).
const CONTENT_SLIDE = new Set(['/', '/cash-to-payday']);
const pathOf = (to: string) => to.split(/[?#]/)[0] ?? '';

function slidesContentOnly(to: string): boolean {
  if (!document.documentElement.classList.contains('app-full')) return false;
  const from = window.location.pathname;
  return from !== pathOf(to) && CONTENT_SLIDE.has(from) && CONTENT_SLIDE.has(pathOf(to));
}

/** Makes `el` an inert overlay pinned to `rect`. */
function pin(el: HTMLElement, rect: DOMRect, className: string): HTMLElement {
  el.classList.add(className);
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  Object.assign(el.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
  });
  return el;
}

/** Copies of the screen being left: its content, and the title bar's contents. */
function copiesOfScreen(): HTMLElement[] {
  const copies: HTMLElement[] = [];
  const scroller = document.getElementById(SCROLLER_ID);
  const main = scroller?.querySelector<HTMLElement>(':scope > main');
  if (scroller && main) {
    // The pinned box clips and moves; the copy inside it keeps the scroll offset.
    const ghost = pin(
      document.createElement('div'),
      scroller.getBoundingClientRect(),
      'content-ghost',
    );
    const content = main.cloneNode(true) as HTMLElement;
    content.style.transform = `translateY(${-scroller.scrollTop}px)`;
    ghost.append(content);
    copies.push(ghost);
  }
  const bar = [...document.querySelectorAll<HTMLElement>('.banner')].find((b) => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && r.top <= 1;
  });
  if (bar)
    copies.push(pin(bar.cloneNode(true) as HTMLElement, bar.getBoundingClientRect(), 'bar-ghost'));
  return copies;
}

let contentSlideRun = 0;

function slideContent(go: () => void, direction: 'forward' | 'back') {
  const root = document.documentElement;
  for (const old of document.querySelectorAll('.content-ghost, .bar-ghost')) old.remove();
  const copies = copiesOfScreen();
  document.body.append(...copies);
  // Off and on again, so a slide still running starts over.
  delete root.dataset.contentSlide;
  void root.offsetWidth;
  root.dataset.contentSlide = direction;
  flushSync(go);
  const run = ++contentSlideRun;
  window.setTimeout(() => {
    for (const copy of copies) copy.remove();
    if (run === contentSlideRun) delete root.dataset.contentSlide;
  }, 700);
}

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
  if (slidesContentOnly(to)) {
    slideContent(go, direction);
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
