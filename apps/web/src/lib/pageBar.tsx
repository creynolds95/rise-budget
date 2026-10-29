import { createContext, useContext, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where a pushed screen's title bar goes: Shell's slot above the scrolling content, so the bar
 * stays put while the content bounces. Without a slot (a screen rendered on its own, as in
 * tests) the bar stays in place and sticks to the top the way it always did.
 */
export const PageBarSlotContext = createContext<HTMLElement | null>(null);

export function PageBar({ className = '', children, ...rest }: HTMLAttributes<HTMLElement>) {
  const slot = useContext(PageBarSlotContext);
  const base = `gutter grid grid-cols-[1fr_auto_1fr] items-center banner bg-banner text-banner-ink shadow-soft ${className}`;
  if (!slot) {
    return (
      <header className={`${base} sticky top-[var(--banner-h,0px)] z-10`} {...rest}>
        {children}
      </header>
    );
  }
  return createPortal(
    <header className={base} {...rest}>
      {children}
    </header>,
    slot,
  );
}
