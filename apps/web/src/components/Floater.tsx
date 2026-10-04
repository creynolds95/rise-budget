import { hideFloater, useFloater } from '../lib/floater';
import { Icon } from './primitives/Icon';

/**
 * The floating card for background work like a bank sync: what's happening, a bar while it
 * runs, and an X. It never blocks the page around it.
 */
export function Floater({ className = '' }: { className?: string }) {
  const m = useFloater();
  if (!m) return null;
  const warn = m.tone === 'warn';
  return (
    <div className={`pointer-events-none flex justify-center px-4 ${className}`}>
      <div
        key={m.id}
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card bg-ink py-3 pr-1 pl-3 text-canvas shadow-soft ${
          m.leaving ? 'animate-fade-out' : 'animate-sheet-in'
        }`}
      >
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            warn ? 'bg-clay' : 'bg-canvas/10'
          }`}
        >
          <span className={m.busy ? 'animate-spin [animation-duration:1.6s]' : ''}>
            <Icon name={m.busy ? 'refresh' : warn ? 'close' : 'check'} size={20} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-body font-semibold">{m.text}</p>
          {!warn && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-canvas/20">
              <div
                className={`h-full rounded-full bg-sage-300 ${
                  m.busy ? 'w-1/3 animate-indeterminate' : 'w-full'
                }`}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={hideFloater}
          className="flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
    </div>
  );
}
