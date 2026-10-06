import { DASHBOARD_TILES, type DashboardTile } from '@rise/shared/schemas';

export const TILE_LABELS: Record<DashboardTile, string> = {
  review: 'Review transactions',
  surplus: 'Surplus',
  budget: 'Budget',
  spending: 'Spending trend',
  transactions: 'Transactions',
  netWorth: 'Net worth',
  comingUp: 'Recurring transactions',
  investments: 'Investments',
  savings: 'Savings goals',
  retirement: 'Retirement',
  debt: 'Debt payoff',
  mortgageSchedule: 'Mortgage payoff schedule',
  mortgageYear: 'Mortgage this year',
};

/** What the Dashboard shows until the user customizes it. */
export const DEFAULT_TILES: readonly DashboardTile[] = [
  'review',
  'surplus',
  'budget',
  'spending',
  'transactions',
  'netWorth',
  'comingUp',
];

/** Every tile in display order: the shown ones as saved, then the hidden ones. */
export function tileOrder(saved: readonly DashboardTile[] | null): {
  all: DashboardTile[];
  shown: Set<DashboardTile>;
} {
  const shown = saved ?? DEFAULT_TILES;
  return {
    all: [...shown, ...DASHBOARD_TILES.filter((t) => !shown.includes(t))],
    shown: new Set(shown),
  };
}
