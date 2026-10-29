/**
 * Below `lg` the page scrolls inside one container (`#app-scroll`, set up in Shell) so the title
 * bar and tab bar stay put while the content bounces at either end. From `lg` up the document
 * scrolls as before. Everything that reads or moves the scroll position goes through here so it
 * doesn't need to know which of the two is in charge.
 */
export const SCROLLER_ID = 'app-scroll';

/** The scroll container when it is the thing that scrolls right now; null when the window is. */
export function scroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(SCROLLER_ID);
  if (!el) return null;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'hidden' ? el : null;
}

export const scrollTop = (): number => scroller()?.scrollTop ?? window.scrollY;

export function scrollToY(top: number, behavior: ScrollBehavior = 'auto') {
  const el = scroller();
  if (el) el.scrollTo({ top, behavior });
  else if (behavior === 'auto') window.scrollTo(0, top);
  else window.scrollTo({ top, behavior });
}

export function scrollByY(dy: number) {
  const el = scroller();
  if (el) el.scrollBy(0, dy);
  else window.scrollBy(0, dy);
}

/** Listens to whichever of the two scrolls; both are watched so a resize can't strand it. */
export function onScroll(fn: () => void): () => void {
  const el = document.getElementById(SCROLLER_ID);
  window.addEventListener('scroll', fn, { passive: true });
  el?.addEventListener('scroll', fn, { passive: true });
  return () => {
    window.removeEventListener('scroll', fn);
    el?.removeEventListener('scroll', fn);
  };
}
