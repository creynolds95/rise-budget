import { hideFloater, useFloater } from '../lib/floater';
import { Icon } from './primitives/Icon';

/**
 * The floating pill for background work like a bank sync. It never blocks the page behind
 * it; tapping the pill itself dismisses it.
 */
export function Floater({ className = '' }: { className?: string }) {
  const m = useFloater();
  if (!m) return null;
  return (
    <div className={`pointer-events-none flex justify-center px-4 ${className}`}>
      <button
        key={m.id}
        type="button"
        role="status"
        aria-live="polite"
        onClick={hideFloater}
        className={`pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-full px-4 py-2 type-body shadow-soft ${
          m.tone === 'warn' ? 'bg-clay text-white' : 'bg-banner text-banner-ink'
        } ${m.leaving ? 'animate-fade-out' : 'animate-fade-in'}`}
      >
        <span className={m.busy ? 'animate-spin motion-reduce:animate-none' : ''}>
          <Icon name={m.busy ? 'refresh' : 'check'} size={18} />
        </span>
        {m.text}
      </button>
    </div>
  );
}
