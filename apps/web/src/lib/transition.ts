import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router';
import { markBack } from './scrollMemory';
import { SCROLLER_ID } from './scroller';

const supportsViewTransitions = () =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// In the installed phone app (boot.js) screens slide without a view transition: while one runs,
// iOS 26 sees a snapshot instead of the sticky title bar and fades the status bar until it ends.
// Here nothing is a snapshot. The content moves as the view transition moved it, with an inert
// copy standing in for the screen being left; the green bar stays live, its buttons fade and
// its title and back arrow slide (styles.css). From lg up the document scrolls instead of
// #app-scroll, so wide screens keep the view transition.
const slidesInPlace = () =>
  document.documentElement.classList.contains('app-full') &&
  window.matchMedia('(width < 64rem)').matches;

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

/** The title bar showing at the top of the screen (not a copy of one). */
const topBar = () =>
  [...document.querySelectorAll<HTMLElement>('.banner:not(.bar-ghost)')].find((b) => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && r.top <= 1;
  });

/** Copies of the screen being left: its content, and the title bar's contents. */
function copiesOfScreen(): HTMLElement[] {
  const copies: HTMLElement[] = [];
  const scroller = document.getElementById(SCROLLER_ID);
  const main = scroller?.querySelector<HTMLElement>(':scope > main');
  if (scroller && main) {
    // The pinned box moves and dims; the view inside it is scrolled to the same offset once it's
    // in the page, so anything sticky in the copy (a search field, a date heading) stays put.
    const ghost = pin(
      document.createElement('div'),
      scroller.getBoundingClientRect(),
      'content-ghost',
    );
    const view = document.createElement('div');
    view.style.cssText = 'height: 100%; overflow: hidden';
    view.append(main.cloneNode(true));
    ghost.append(view);
    copies.push(ghost);
  }
  const bar = topBar();
  if (bar)
    copies.push(pin(bar.cloneNode(true) as HTMLElement, bar.getBoundingClientRect(), 'bar-ghost'));
  return copies;
}

/**
 * How far the back arrow travels (styles.css), as a native bar's back button comes out of the
 * previous title: forward, the new bar's arrow starts at the old title's left edge; back, the
 * old bar's arrow goes to the new title's.
 */
function arrowShift(arrowBar: Element | undefined, titleBar: Element | undefined): number {
  const arrow = arrowBar?.querySelector('a[data-transition="back"] svg');
  const title = titleBar?.querySelector('[data-bar-title]');
  if (!arrow || !title) return 0;
  return title.getBoundingClientRect().left - arrow.getBoundingClientRect().left;
}

let contentSlideRun = 0;
/** The slide takes 300 ms (styles.css --slide-time); the copies go a little after. */
const SLIDE_DONE_MS = 400;

function slideContent(go: () => void, direction: 'forward' | 'back') {
  const root = document.documentElement;
  for (const old of document.querySelectorAll('.content-ghost, .bar-ghost')) old.remove();
  const copies = copiesOfScreen();
  document.body.append(...copies);
  const view = copies.find((c) => c.classList.contains('content-ghost'))?.firstElementChild;
  if (view) view.scrollTop = document.getElementById(SCROLLER_ID)?.scrollTop ?? 0;
  // Off and on again, so a slide still running starts over.
  delete root.dataset.contentSlide;
  flushSync(go);
  // Measured before the slide starts, while nothing in either bar has moved.
  const [live, ghost] = [topBar(), copies.find((c) => c.classList.contains('bar-ghost'))];
  const shift = direction === 'forward' ? arrowShift(live, ghost) : arrowShift(ghost, live);
  root.style.setProperty('--arrow-shift', `${shift}px`);
  void root.offsetWidth;
  root.dataset.contentSlide = direction;
  const run = ++contentSlideRun;
  window.setTimeout(() => {
    for (const copy of copies) copy.remove();
    if (run !== contentSlideRun) return;
    delete root.dataset.contentSlide;
    root.style.removeProperty('--arrow-shift');
  }, SLIDE_DONE_MS);
}

/**
 * Slides the next screen in (or the current one back out) like a native push/pop
 * (DESIGN-SYSTEM.md §4's depth model): in place in the installed phone app (slideContent), with
 * the browser's View Transitions API elsewhere where it's supported, and as a plain navigation
 * everywhere else.
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
  if (slidesInPlace()) {
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
