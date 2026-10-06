/**
 * Freezes the page under a sheet or menu without moving anything. The body is NOT pinned with
 * `position: fixed`: on an installed iPhone PWA that re-lays-out the page and the viewport
 * comes back short, lifting the tab bar and the menu off the bottom of the screen. Instead
 * `overflow: hidden` goes on <html> only (also setting it on <body> turns the body into its own
 * scroll container, which un-sticks the tab bar and sends it off the bottom), and touch moves
 * that would scroll the page
 * (anything not inside an element that can scroll itself) are cancelled, which is what stops
 * iOS from dragging the page behind. Counted, so a sheet opened from inside another sheet
 * doesn't unlock the page early.
 */
let locks = 0;
let saved: string | null = null;

export const isScrollLocked = () => locks > 0;

/** True when a touch starting at `el` would scroll that element or an ancestor instead of the page. */
function scrollsItself(el: EventTarget | null): boolean {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

const onTouchMove = (e: TouchEvent) => {
  if (e.touches.length === 1 && !scrollsItself(e.target) && e.cancelable) e.preventDefault();
};

export function lockScroll(): () => void {
  if (locks++ === 0) {
    const html = document.documentElement;
    saved = html.style.overflow;
    html.style.overflow = 'hidden';
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks > 0 || saved === null) return;
    document.removeEventListener('touchmove', onTouchMove);
    document.documentElement.style.overflow = saved;
    saved = null;
  };
}
