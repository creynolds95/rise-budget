/**
 * Every screen and its depth from a tab (DESIGN-SYSTEM.md §4): two pushes at most.
 * Anything deeper is a sheet or a filtered list. A test holds this line.
 */
export type Tab = 'dashboard' | 'accounts' | 'transactions' | 'budget' | 'reports';

export const TABS: { tab: Tab; path: string; label: string }[] = [
  { tab: 'dashboard', path: '/', label: 'Dashboard' },
  { tab: 'accounts', path: '/accounts', label: 'Accounts' },
  { tab: 'transactions', path: '/transactions', label: 'Transactions' },
  { tab: 'budget', path: '/budget', label: 'Budget' },
  { tab: 'reports', path: '/reports', label: 'Reports' },
];

export const ROUTES = [
  { path: '/', depth: 0 },
  { path: '/accounts', depth: 0 },
  { path: '/transactions', depth: 0 },
  { path: '/budget', depth: 0 },
  { path: '/reports', depth: 0 },
  { path: '/settings', depth: 0 },
  /** Pushed from the Dashboard's review count. */
  { path: '/review', depth: 1, from: '/' },
  /** Pushed from the Dashboard. */
  { path: '/cash-to-payday', depth: 1, from: '/' },
  { path: '/accounts/:id', depth: 1 },
  { path: '/transactions/:id', depth: 1 },
  { path: '/budget/:categoryId', depth: 1 },
  { path: '/settings/:section', depth: 1 },
] as const;

export const MAX_DEPTH = 2;
