/* global window, document, localStorage */
// Runs before first paint; a file, not inline, so the CSP can forbid inline script.
window.__splashStart = Date.now();
// Apply a pinned theme before first paint, so there's no flash of the wrong one.
// No setting stored (the default) means "match system", which needs no attribute.
try {
  var riseTheme = localStorage.getItem('rise-theme');
  if (riseTheme === 'light' || riseTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', riseTheme);
  }
} catch {
  // Storage blocked: fall back to the system theme.
}
