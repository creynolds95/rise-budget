/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build identity; a new build discards the persisted query cache (main.tsx). */
declare const __APP_VERSION__: string;
/** Short commit the build came from (`local` off CI). */
declare const __APP_COMMIT__: string;

interface Window {
  /** Set by an inline script in index.html, ahead of main.tsx, for the splash's min-visible time. */
  __splashStart?: number;
}
