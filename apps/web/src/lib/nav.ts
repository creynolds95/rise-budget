/**
 * `?from=Label|/path` names where a detail page's back control goes (DESIGN-SYSTEM §5: back
 * always names its origin). Only same-app paths are accepted; anything else falls back.
 */
export function backFrom(
  raw: string | null,
  fallback = { label: 'Transactions', to: '/transactions' },
): { label: string; to: string } {
  const [label, to] = (raw ?? '').split('|');
  return label?.trim() && to?.startsWith('/') && !to.startsWith('//') ? { label, to } : fallback;
}
