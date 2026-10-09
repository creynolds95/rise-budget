/* global window, document, localStorage, navigator, screen */
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
// The installed iPhone app reports a window one status bar shorter than the screen until the
// document itself is screen-tall, and nothing draws in the strip that leaves under the tab bar.
// Installed, the app is sized to the screen (styles.css, html.app-full) so the window grows to it.
var riseRoot = document.documentElement;
if (
  navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
) {
  riseRoot.classList.add('app-full');
  var riseScreenH = function () {
    var landscape = window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
    var long = Math.max(screen.width, screen.height);
    var short = Math.min(screen.width, screen.height);
    riseRoot.style.setProperty('--screen-h', (landscape ? short : long) + 'px');
  };
  riseScreenH();
  window.addEventListener('orientationchange', riseScreenH);
  window.addEventListener('resize', riseScreenH);
}
try {
  localStorage.removeItem('rise-vp'); // the old on-phone layout test's switch
} catch {
  // Storage blocked: nothing to clean up.
}
