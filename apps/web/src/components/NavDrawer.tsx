import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { MOTION_EASE, MOTION_IN_MS, MOTION_OUT_MS } from '../lib/motion';
import { lockScroll } from '../lib/scrollLock';

/** The menu on every tab. Desktop's sidebar lists the same items under the tabs. */
export const MENU_ITEMS: { label: string; to: string }[] = [
  { label: 'Surplus', to: '/cash-to-payday' },
  { label: 'Financial health', to: '/financial-health' },
  { label: 'Review', to: '/review' },
  { label: 'Recurring', to: '/recurring' },
  { label: 'Reports', to: '/settings/reports?from=Dashboard|/' },
  { label: 'Investments', to: '/settings/investments?from=Dashboard|/' },
  { label: 'Categories', to: '/settings/categories?from=Dashboard|/' },
  { label: 'Rules', to: '/settings/rules?from=Dashboard|/' },
  { label: 'Settings', to: '/settings' },
];

/**
 * The menu behind the three-line button: slides in from the left, closes by tapping the
 * dimmed page, swiping it back left, or choosing something.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), MOTION_OUT_MS);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);
  const startX = useRef<number | null>(null);
  if (!mounted) return null;
  const motion = {
    transitionDuration: `${shown ? MOTION_IN_MS : MOTION_OUT_MS}ms`,
    transitionTimingFunction: MOTION_EASE,
  };
  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      onTouchStart={(e) => (startX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        if (startX.current !== null && t && startX.current - t.clientX > 50) onClose();
        startX.current = null;
      }}
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40 transition-opacity"
        style={{ opacity: shown ? 1 : 0, ...motion }}
      />
      <nav
        aria-label="Menu"
        data-no-swipe
        className="absolute inset-y-0 left-0 flex w-[78%] max-w-xs flex-col border-r border-hairline bg-surface pt-[max(12px,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform"
        style={{
          transform: shown ? 'translateX(0)' : 'translateX(-100%)',
          ...motion,
        }}
      >
        <span className="gutter pt-4 pb-5 font-serif text-4xl tracking-tight text-sage-700">
          Rise
        </span>
        <ul className="flex flex-col border-t border-hairline">
          {MENU_ITEMS.map((i) => (
            <li key={i.to} className="border-b border-hairline">
              <Link
                to={i.to}
                onClick={onClose}
                className="gutter flex min-h-12 items-center type-body active:bg-sage-100"
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
