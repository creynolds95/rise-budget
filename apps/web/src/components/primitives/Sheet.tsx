import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * iOS Safari doesn't shrink `dvh` for the keyboard until it's fully open, so a sheet sized
 * by `92dvh` alone briefly renders taller than what's actually visible above the keyboard —
 * the tail of its content sits behind the keyboard instead of being scrollable into view.
 * `visualViewport` reports the real visible height as the keyboard animates, so the sheet's
 * cap tracks it directly. In an installed (standalone) PWA, iOS is known to skip the
 * `resize`/`scroll` events on `visualViewport` when the keyboard opens, so a short poll while
 * the sheet is up is the fallback that actually catches the change.
 */
function useVisibleViewportHeight(active: boolean) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
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
  return height;
}

/**
 * A bottom sheet: the way past the two-push depth limit (§4). Plain sheets close with ✕;
 * form sheets pass `action` and get the Cancel · Title · Save header, so a sheet that
 * changes something always says so in the same place.
 */
export function Sheet({
  open,
  title,
  onClose,
  action,
  back,
  children,
  fullScreen = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  /** A page inside the sheet: the left slot goes back instead of cancelling. */
  back?: { label: string; onClick: () => void } | undefined;
  children: ReactNode;
  /**
   * A full page instead of a bottom sheet (Monarch's amount editor): nothing under the fold
   * is load-bearing once you're editing, so the keyboard is free to cover it — no viewport
   * math needed, unlike a bottom sheet that has to keep its content reachable above it.
   */
  fullScreen?: boolean;
}) {
  const id = useId();
  const viewportHeight = useVisibleViewportHeight(open && !fullScreen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // The page underneath must not scroll while a sheet is up (iOS rubber-banding).
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;

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

  if (fullScreen) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-canvas"
      >
        {header}
        <div className="gutter flex-1 overflow-y-auto pt-2 pb-[max(20px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
      <button
        aria-label="Close"
        tabIndex={-1}
        className="animate-fade-in absolute inset-0 bg-ink/25"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        style={viewportHeight ? { maxHeight: `${viewportHeight * 0.92}px` } : undefined}
        className="animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-canvas shadow-soft md:max-w-lg md:rounded-[20px]"
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-hairline" />
        {header}
        <div className="gutter overflow-y-auto pt-2 pb-[max(20px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
