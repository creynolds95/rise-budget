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

/** A pull starts a bank sync at most this often; in between it only refetches Rise's own data. */
export const SYNC_EVERY_MS = 3_600_000;

/** True when the newest known sync (ISO string or epoch ms; the later of the two) is over an hour old. */
export function syncDue(now: number, ...last: (string | number | null | undefined)[]): boolean {
  const t = Math.max(
    0,
    ...last.map((v) => (typeof v === 'string' ? Date.parse(v) : (v ?? 0)) || 0),
  );
  return now - t >= SYNC_EVERY_MS;
}

/** Pulls leave this many of SimpleFIN's daily requests for the owner's scheduled syncs. */
const PULL_DAILY_CAP = 8;

/** False once the last day already holds `PULL_DAILY_CAP` runs, so a pull never crowds out the schedule. */
export function dailyRoom(now: number, starts: string[]): boolean {
  return starts.filter((t) => now - Date.parse(t) < 86_400_000).length < PULL_DAILY_CAP;
}
