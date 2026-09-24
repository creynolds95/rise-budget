import { useEffect, useId, type ReactNode } from 'react';

/** A bottom sheet: the way past the two-push depth limit (§4). */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
      <button aria-label="Close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-card bg-surface pb-[max(16px,env(safe-area-inset-bottom))] shadow-soft md:max-w-lg md:rounded-card"
      >
        <div className="gutter sticky top-0 flex items-center justify-between bg-surface pt-4 pb-2">
          <h2 id={id} className="type-title">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="min-h-11 min-w-11 text-ink-muted"
            aria-label="Close sheet"
          >
            ✕
          </button>
        </div>
        <div className="gutter">{children}</div>
      </div>
    </div>
  );
}
