/**
 * The Transfers group (account moves, card payments) is never spending. Every category in it
 * is unbudgeted, whatever it was created or moved in as, so nothing in it reaches the budget,
 * the Dashboard spending chart, or reports.
 */
export const TRANSFERS_GROUP = 'Transfers';

export function isTransfersGroup(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === TRANSFERS_GROUP.toLowerCase();
}

/** The `budgeted` flag a category gets in a group: always off in Transfers. */
export function budgetedInGroup(groupName: string | null | undefined, requested: boolean): boolean {
  return requested && !isTransfersGroup(groupName);
}
