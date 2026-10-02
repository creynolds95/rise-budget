/**
 * `?from=Label|/path` names where a detail page's back control goes (DESIGN-SYSTEM §5: back
 * always names its origin). Only same-app paths are accepted; anything else falls back.
 */
export function backFrom(
  raw: string | null,
  fallback = { label: 'Transactions', to: '/transactions' },
): { label: string; to: string } {
  const text = raw ?? '';
  const cut = text.indexOf('|');
  // Split on the first bar only: the path may itself carry a nested `?from=` to chain back.
  const label = cut < 0 ? '' : text.slice(0, cut);
  const to = cut < 0 ? '' : text.slice(cut + 1);
  return label.trim() && to.startsWith('/') && !to.startsWith('//') ? { label, to } : fallback;
}
