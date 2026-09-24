import { useEffect, useState } from 'react';

/**
 * Mirrors Tailwind's `lg:` breakpoint (1024px) in JS, for the few places behavior itself
 * changes by viewport — not just layout (H5: budget's master/detail vs. mobile's full push).
 */
const QUERY = '(min-width: 1024px)';

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
