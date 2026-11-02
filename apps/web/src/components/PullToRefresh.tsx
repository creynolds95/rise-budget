import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { edgeWidth } from '../lib/gestures';
import { isArmed, judgePull, PULL_THRESHOLD, pullOffset, refreshData } from '../lib/pullRefresh';
import { scroller } from '../lib/scroller';

const SKIP = '[data-zoomable], [data-no-swipe], input, textarea, select, [role=dialog]';

/**
 * Drag down from the top of a tab screen to reload its data in place. Phone layout only (the scroller is
 * `#app-scroll`); a touch starts a pull only when that container is scrolled to the very top,
 * starts clear of the left edge strip, and turns out to be mostly vertical, so the menu drag and
 * the swipe-back guard keep their gestures. The indicator is moved directly, not through state.
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const dot = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'idle' | 'pull' | 'loading' = 'idle';
    let top = 0;

    const paint = (offset: number, armed: boolean, spin: boolean) => {
      const el = dot.current;
      if (!el) return;
      el.style.top = `${top}px`;
      el.style.opacity = offset > 4 || spin ? '1' : '0';
      el.style.transform = `translate(-50%, ${offset - 40}px)`;
      el.dataset['armed'] = armed ? '1' : '0';
      el.dataset['spin'] = spin ? '1' : '0';
    };
    const reset = () => {
      const el = dot.current;
      if (el) el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
      paint(0, false, false);
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      const t = e.touches[0];
      const el = e.target as Element | null;
      const sc = scroller();
      if (mode === 'loading' || !t || e.touches.length !== 1 || !sc || sc.scrollTop > 0) return;
      if (t.clientX <= edgeWidth(window.location.pathname) || el?.closest(SKIP)) return;
      top = sc.getBoundingClientRect().top;
      start = { x: t.clientX, y: t.clientY };
      mode = 'idle';
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t || mode === 'loading') return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (mode === 'idle') {
        const v = judgePull(dx, dy);
        if (v === 'undecided') return;
        if (v === 'ignore' || (scroller()?.scrollTop ?? 1) > 0) {
          start = null;
          return;
        }
        mode = 'pull';
        const el = dot.current;
        if (el) el.style.transition = 'none';
      }
      // Keep iOS from rubber-banding the page while the indicator follows the finger.
      if (e.cancelable) e.preventDefault();
      paint(pullOffset(dy), isArmed(dy), false);
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const wasPull = mode === 'pull';
      const dy = start && t ? t.clientY - start.y : 0;
      start = null;
      if (!wasPull) return;
      if (isArmed(dy)) {
        mode = 'loading';
        const el = dot.current;
        if (el) el.style.transition = 'transform 150ms ease-out';
        paint(pullOffset(PULL_THRESHOLD), true, true);
        void refreshData(() => qc.refetchQueries({ type: 'active' })).finally(() => {
          mode = 'idle';
          reset();
        });
      } else {
        mode = 'idle';
        reset();
      }
    };
    const onCancel = () => {
      start = null;
      if (mode === 'pull') {
        mode = 'idle';
        reset();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled, qc]);

  if (!enabled) return null;
  return (
    <div
      ref={dot}
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-30 flex size-9 items-center justify-center rounded-full border border-hairline bg-surface text-sage-700 opacity-0 shadow-soft"
      style={{ transform: 'translate(-50%, -40px)' }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        className="pull-icon fill-none stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
    </div>
  );
}
