/** Pull distance (px of finger travel) that arms a reload. */
export const PULL_THRESHOLD = 72;
/** Finger travel before a touch is judged vertical or not. */
const LOCK_AFTER = 10;
/** The indicator stops following the finger past this. */
const MAX_PULL = 120;

export type PullVerdict = 'undecided' | 'pull' | 'ignore';

/**
 * Decide what a touch is once it has moved: a pull-down only when it heads down and is clearly
 * more vertical than sideways, so the menu drag (sideways) and swipe-back never become a pull.
 */
export function judgePull(dx: number, dy: number): PullVerdict {
  if (Math.hypot(dx, dy) < LOCK_AFTER) return 'undecided';
  return dy > 0 && dy > Math.abs(dx) * 1.5 ? 'pull' : 'ignore';
}

/** How far the indicator travels for `dy` of finger travel: resists as it goes. */
export function pullOffset(dy: number): number {
  const d = Math.max(0, dy);
  return Math.min(MAX_PULL, d * 0.55);
}

export const isArmed = (dy: number): boolean => dy >= PULL_THRESHOLD;
