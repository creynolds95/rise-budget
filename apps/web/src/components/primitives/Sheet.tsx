import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';
import { MOTION_EASE, MOTION_IN_MS, MOTION_OUT_MS } from '../../lib/motion';
import { lockScroll } from '../../lib/scrollLock';

/**
 * iOS Safari doesn't shrink `dvh` for the keyboard until it's fully open, so a sheet sized
 * by `92dvh` alone briefly renders taller than what's actually visible above the keyboard —
 * the tail of its content sits behind the keyboard instead of being scrollable into view.
 * `visualViewport` reports the real visible height as the keyboard animates, so the sheet's
 * cap tracks it directly. In an installed (standalone) PWA, iOS is known to skip the
 * `resize`/`scroll` events on `visualViewport` when the keyboard opens, so a short poll while
 * the sheet is up is the fallback that actually catches the change.
 */
function useVisibleViewport(active: boolean) {
  const [view, setView] = useState<{ height: number; top: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const height = Math.round(vv.height);
      const top = Math.round(vv.offsetTop);
      // The layout viewport doesn't shrink for the keyboard in an installed PWA; the visual one does.
      const keyboard = window.innerHeight - vv.height > 150;
      setView((v) =>
        v && v.height === height && v.top === top && v.keyboard === keyboard
          ? v
          : { height, top, keyboard },
      );
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    const poll = window.setInterval(update, 150);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.clearInterval(poll);
    };
  }, [active]);
  return view;
}

/** True while the on-screen keyboard covers part of the sheet, so its content can tighten up. */
const KeyboardContext = createContext(false);
export const useSheetKeyboard = () => useContext(KeyboardContext);

/**
 * Opens the keyboard with the sheet, for a field marked `data-sheet-focus`. Focusing that field
 * straight away doesn't work on iOS: it's still translated below the screen by the rise
 * animation, so iOS scrolls the whole page down to reach it and the sheet then appears to drop
 * in from the top while the keyboard comes up from the bottom. Instead a stand-in field that's
 * already on screen takes focus inside the tap (which is what lets the keyboard open at all),
 * and focus moves to the real field once the sheet has landed. iOS keeps the keyboard up across
 * that hand-off. Anything typed in the meantime is carried over.
 */
function useFocusOnLand(open: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  const proxy = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const target = panel.current?.querySelector<HTMLInputElement>('[data-sheet-focus]');
    const stand = proxy.current;
    if (!target || !stand) return;
    stand.inputMode = target.inputMode;
    stand.disabled = false;
    stand.value = '';
    stand.focus({ preventScroll: true });
    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      // Leave focus alone if the person has already moved it somewhere else.
      if (document.activeElement === stand) {
        if (stand.value) {
          // React tracks a controlled input's value, so set it the way typing would.
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          set?.call(target, stand.value);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.focus({ preventScroll: true });
        } else {
          target.focus({ preventScroll: true });
          target.select();
        }
      }
      stand.value = '';
      // Out of the keyboard's previous/next order once its job is done.
      stand.disabled = true;
    };
    const el = panel.current;
    const onEnd = (e: AnimationEvent) => e.target === el && land();
    el?.addEventListener('animationend', onEnd);
    // Fallback in case the animation never reports finishing.
    const t = window.setTimeout(land, MOTION_IN_MS + 100);
    return () => {
      el?.removeEventListener('animationend', onEnd);
      window.clearTimeout(t);
    };
  }, [open]);
  const standIn = (
    <input
      ref={proxy}
      aria-hidden
      tabIndex={-1}
      disabled
      // On screen (so iOS has nothing to scroll to) but invisible; 16px so iOS doesn't zoom.
      className="pointer-events-none fixed top-0 left-0 z-50 h-px w-px text-[16px] opacity-0"
    />
  );
  return { panel, standIn };
}

/**
 * Keeps a sheet mounted while it slides back out, so closing is as visible as opening.
 * `closing` is true for the exit animation; `mounted` is false once it's done.
 */
function useExit(open: boolean) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), MOTION_OUT_MS);
    return () => window.clearTimeout(t);
  }, [open]);
  return { mounted: open || mounted, closing: !open };
}

/**
 * Pull a sheet down by its header to dismiss it: it follows the finger, and lets go past a
 * third of its height or on a quick flick.
 */
function useDragDown(onClose: () => void, panel: RefObject<HTMLDivElement | null>) {
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const move = (dy: number, animate: boolean) => {
    const el = panel.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${MOTION_OUT_MS}ms ${MOTION_EASE}` : 'none';
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const handlers = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const t = e.touches[0];
      if (t) drag.current = { y: t.clientY, t: Date.now(), dy: 0 };
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      const t = e.touches[0];
      if (!drag.current || !t) return;
      drag.current.dy = Math.max(0, t.clientY - drag.current.y);
      move(drag.current.dy, false);
    },
    onTouchEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const height = panel.current?.offsetHeight ?? 600;
      const flick = d.dy / Math.max(1, Date.now() - d.t) > 0.6 && d.dy > 40;
      if (d.dy > height / 3 || flick) onClose();
      else move(0, true);
    },
  };
  return { handlers };
}

/**
 * A bottom sheet: the way past the two-push depth limit (§4). Plain sheets close with ✕;
 * form sheets pass `action` and get the Cancel · Title · Save header, so a sheet that
 * changes something always says so in the same place. Both rise from the bottom, close by
 * sliding back down, and can be pulled down by the header.
 */
export function Sheet({
  open,
  title,
  onClose,
  action,
  back,
  children,
  footer,
  fullScreen = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  /** A page inside the sheet: the left slot goes back instead of cancelling. */
  back?: { label: string; onClick: () => void } | undefined;
  children: ReactNode;
  /** Pinned under the scrolling content, flush with the bottom edge (Clear all · Apply). */
  footer?: ReactNode;
  /**
   * A full page instead of a bottom sheet (Monarch's amount editor). It's sized to what's
   * visible above the keyboard, so anything pinned to its bottom stays reachable while typing.
   */
  fullScreen?: boolean;
}) {
  const id = useId();
  const { mounted, closing } = useExit(open);
  const view = useVisibleViewport(open);
  const { panel, standIn } = useFocusOnLand(open);
  const { handlers } = useDragDown(onClose, panel);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // The page underneath must not scroll while a sheet is up.
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);
  if (!mounted) return null;

  const header = (
    <div className="grid min-h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-2">
      {back ? (
        <button
          onClick={back.onClick}
          className="flex min-h-11 items-center gap-1 justify-self-start px-2 text-sage-700"
        >
          <span aria-hidden>‹</span>
          {back.label}
        </button>
      ) : action ? (
        <button onClick={onClose} className="min-h-11 justify-self-start px-2 text-ink-muted">
          Cancel
        </button>
      ) : (
        <span />
      )}
      <h2 id={id} className="truncate px-2 text-center text-[17px] font-semibold">
        {title}
      </h2>
      {action ? (
        <button
          onClick={action.onClick}
          disabled={action.disabled}
          className="min-h-11 justify-self-end px-2 font-semibold text-sage-700 disabled:opacity-40"
        >
          {action.label}
        </button>
      ) : (
        <button
          onClick={onClose}
          className="flex size-11 items-center justify-center justify-self-end text-ink-muted"
          aria-label="Close sheet"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="stroke-current">
            <path d="M1 1l12 12M13 1L1 13" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );

  const bottomPad = footer ? 'pb-4' : 'pb-[max(20px,env(safe-area-inset-bottom))]';
  const footerBar = footer && (
    <div className="gutter shrink-0 border-t border-hairline bg-canvas pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      {footer}
    </div>
  );

  const keyboard = view?.keyboard ?? false;
  if (fullScreen) {
    return (
      <KeyboardContext.Provider value={keyboard}>
        {standIn}
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          style={keyboard && view ? { top: view.top, height: view.height } : undefined}
          className={`${closing ? 'animate-sheet-out' : 'animate-sheet-up'} fixed inset-0 z-40 flex flex-col bg-canvas pt-[env(safe-area-inset-top)]`}
        >
          <div {...handlers}>{header}</div>
          <div
            className={`gutter min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 ${keyboard ? 'pb-0' : bottomPad}`}
          >
            {children}
          </div>
          {footerBar}
        </div>
      </KeyboardContext.Provider>
    );
  }
  return (
    <KeyboardContext.Provider value={keyboard}>
      {standIn}
      <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
        <button
          aria-label="Close"
          tabIndex={-1}
          className={`${closing ? 'animate-fade-out' : 'animate-fade-in'} absolute inset-0 touch-none bg-ink/25`}
          onClick={onClose}
        />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          style={view ? { maxHeight: `${view.height * 0.92}px` } : undefined}
          className={`${closing ? 'animate-sheet-out' : 'animate-sheet-up'} relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-canvas shadow-soft md:max-w-lg md:rounded-[20px]`}
        >
          <div {...handlers}>
            <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-hairline" />
            {header}
          </div>
          <div className={`gutter min-h-0 overflow-y-auto overscroll-contain pt-2 ${bottomPad}`}>
            {children}
          </div>
          {footerBar}
        </div>
      </div>
    </KeyboardContext.Provider>
  );
}
