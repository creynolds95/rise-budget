/** Light/dark mode: match the system, or pin one permanently. Applied via `data-theme` on `<html>`. */

export type ThemeSetting = 'system' | 'light' | 'dark';
const KEY = 'rise-theme';

export function getThemeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Sets the setting and applies it immediately — no reload needed. */
export function setThemeSetting(setting: ThemeSetting): void {
  try {
    if (setting === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, setting);
  } catch {
    // Storage can be unavailable (private mode); the choice just won't survive a reload.
  }
  applyTheme(setting);
}

/** Sets (or clears) `data-theme` on the root element so CSS can key off it. */
export function applyTheme(setting: ThemeSetting): void {
  const root = document.documentElement;
  if (setting === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', setting);
}
