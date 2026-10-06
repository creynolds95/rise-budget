/**
 * Keeps a focused text field visible above the on-screen keyboard, app-wide. iOS (and an
 * installed PWA especially) scrolls inconsistently: sometimes not at all, sometimes the whole
 * page behind a sheet. So every focus is handled here, once, instead of per screen: after the
 * keyboard settles, the field's scrollable ancestors are nudged until it sits inside the
 * visible viewport, and `--kb` (the keyboard's height) pads the page so short pages can scroll
 * far enough. Sheets size themselves to the visible viewport (primitives/Sheet).
 */

/** Gap kept between the field and the keyboard / top edge. */
const MARGIN = 16;
const KEYBOARD_MIN = 150;

const NON_TEXT = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'file',
  'color',
  'image',
  'hidden',
]);

export function isTextField(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLInputElement) return !el.disabled && !el.readOnly && !NON_TEXT.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** How far to scroll (positive = content moves up) to bring a rect inside the visible band. */
export function scrollDelta(
  rect: { top: number; bottom: number },
  visible: { top: number; bottom: number },
  margin = MARGIN,
): number {
  const room = visible.bottom - visible.top - margin * 2;
  // A field taller than the band: line its top up rather than chase its bottom.
  if (rect.bottom - rect.top > room) return rect.top - (visible.top + margin);
  if (rect.bottom > visible.bottom - margin) return rect.bottom - (visible.bottom - margin);
  if (rect.top < visible.top + margin) return rect.top - (visible.top + margin);
  return 0;
}

function scrollParent(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function revealField(el: HTMLElement) {
  const vv = window.visualViewport;
  const visible = vv
    ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height }
    : { top: 0, bottom: window.innerHeight };
  let delta = scrollDelta(el.getBoundingClientRect(), visible);
  if (delta === 0) return;
  for (let p = scrollParent(el); p && delta !== 0; p = scrollParent(p)) {
    const before = p.scrollTop;
    p.scrollTop = before + delta;
    delta -= p.scrollTop - before;
  }
  // Whatever the inner scrollers couldn't absorb falls to the page (a no-op while it's frozen).
  if (delta !== 0) window.scrollBy(0, delta);
}

export function installKeyboardAvoidance() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  let timers: number[] = [];

  const active = () => (isTextField(document.activeElement) ? document.activeElement : null);
  const reveal = () => {
    const el = active();
    if (el) revealField(el);
  };
  const clear = () => {
    timers.forEach((t) => window.clearTimeout(t));
    timers = [];
  };
  const padPage = () => {
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb', active() && kb > KEYBOARD_MIN ? `${Math.round(kb)}px` : '0px');
  };

  document.addEventListener('focusin', () => {
    clear();
    if (!active()) return;
    // The keyboard animates in over ~300ms and iOS does its own scroll first; re-check as it settles.
    for (const ms of [0, 120, 350, 700]) {
      timers.push(
        window.setTimeout(() => {
          padPage();
          reveal();
        }, ms),
      );
    }
  });
  document.addEventListener('focusout', () => {
    clear();
    timers.push(window.setTimeout(padPage, 50));
  });
  vv?.addEventListener('resize', () => {
    padPage();
    reveal();
  });
  // Typing can grow a field (a textarea) or reflow the form under it.
  document.addEventListener('input', () => window.requestAnimationFrame(reveal));
}
