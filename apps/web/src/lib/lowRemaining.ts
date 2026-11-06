/** Share of the planned amount at or under which the remaining pill warns in gold. */
export const LOW_REMAINING_PCT = 10;

/** True when something is left, but no more than 10% of what was planned. Integer cents only. */
export function isLowRemaining(remainingCents: number, plannedCents: number): boolean {
  if (remainingCents <= 0 || plannedCents <= 0) return false;
  return remainingCents * 100 <= plannedCents * LOW_REMAINING_PCT;
}
