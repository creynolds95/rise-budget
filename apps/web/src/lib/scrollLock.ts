/**
 * Freezes the page under a sheet or menu. `overflow: hidden` on <body> alone doesn't stop
 * iOS Safari (or an installed PWA) from scrolling the page behind, so the body is pinned in
 * place with `position: fixed` at the current offset and put back where it was on release.
 * Counted, so a sheet opened from inside another sheet doesn't unlock the page early.
 */
let locks = 0;
let saved: { y: number; style: string; path: string } | null = null;

export function lockScroll(): () => void {
  if (locks++ === 0) {
    const body = document.body;
    const y = window.scrollY;
    saved = { y, style: body.getAttribute('style') ?? '', path: location.pathname };
    Object.assign(body.style, {
      position: 'fixed',
      top: `-${y}px`,
      left: '0',
      right: '0',
      width: '100%',
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks > 0 || !saved) return;
    const { y, style, path } = saved;
    saved = null;
    if (style) document.body.setAttribute('style', style);
    else document.body.removeAttribute('style');
    // Choosing a menu item lands on a new page, which keeps its own scroll position.
    if (location.pathname === path) window.scrollTo(0, y);
  };
}
