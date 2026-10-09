/**
 * The phone shell's height. In the installed app iOS can report a window shorter than the
 * screen (an 812 window on an 874 screen), which left the tab bar floating above the home
 * indicator. When the app is installed and no keyboard is up, the shell takes the screen's
 * height instead; otherwise the window's.
 */
const KEYBOARD_MIN = 150;

export type HeightInputs = {
  /** `window.innerHeight` */
  inner: number;
  /** `screen.height` */
  screen: number;
  /** `visualViewport.height`, when there is one */
  visible: number | null;
  installed: boolean;
  portrait: boolean;
};

export function appHeight({ inner, screen, visible, installed, portrait }: HeightInputs): number {
  const keyboard = visible !== null && visible < inner - KEYBOARD_MIN;
  return installed && portrait && !keyboard ? Math.max(inner, screen) : inner;
}

export function installAppHeight() {
  const root = document.documentElement;
  const set = () => {
    const h = appHeight({
      inner: window.innerHeight,
      screen: window.screen.height,
      visible: window.visualViewport?.height ?? null,
      installed:
        (navigator as { standalone?: boolean }).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches,
      portrait: window.matchMedia('(orientation: portrait)').matches,
    });
    root.style.setProperty('--app-h', `${h}px`);
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', set);
  window.visualViewport?.addEventListener('resize', set);
}
