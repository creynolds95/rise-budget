/**
 * The first-run guide (/welcome). It opens on its own only for a brand-new install: no
 * accounts at all (synced or manual, archived included) and not finished or skipped on this
 * device. Any install with accounts never sees it unless opened from Settings.
 */
const DONE_KEY = 'rise-welcome-done';
const STEP_KEY = 'rise-welcome-step';

export const WELCOME_STEPS = 4;

export function shouldOpenWelcome(accountCount: number | undefined, done: boolean): boolean {
  return accountCount === 0 && !done;
}

/** Clamps a stored step to the guide's range; anything unreadable starts at the top. */
export function clampStep(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < WELCOME_STEPS ? n : 0;
}

// Storage can throw (private mode, blocked site data); the guide then just forgets.
export function welcomeDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}
export function finishWelcome() {
  try {
    localStorage.setItem(DONE_KEY, '1');
    localStorage.removeItem(STEP_KEY);
  } catch {
    /* nothing to keep */
  }
}
export function savedStep(): number {
  try {
    return clampStep(localStorage.getItem(STEP_KEY));
  } catch {
    return 0;
  }
}
export function saveStep(step: number) {
  try {
    localStorage.setItem(STEP_KEY, String(step));
  } catch {
    /* nothing to keep */
  }
}
