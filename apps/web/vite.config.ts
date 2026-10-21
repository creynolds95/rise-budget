import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Node's env without pulling in @types/node for one variable.
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const build = {
  version: new Date().toISOString(),
  commit: env['GITHUB_SHA']?.slice(0, 7) ?? 'local',
};

export default defineConfig({
  define: {
    // Each build busts the persisted cache, so old data shapes never meet new code.
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
  },
  plugins: [
    // The deployed build's identity, outside the service worker's precache, so Settings can
    // tell a stale installed app from the latest deploy.
    {
      name: 'rise-version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
      },
    },
    react(),
    tailwindcss(),
    // ARCHITECTURE §7. The service worker precaches the app shell only. API reads are
    // cached by the persisted query cache instead: a service-worker cache of authorised
    // responses would outlive sign-out and bypass the "data from {time}" bar.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rise',
        short_name: 'Rise',
        description: 'Your budget, one month at a time.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FAFAF7',
        theme_color: '#FAFAF7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Push and notification taps (SPEC §8.2); a plain file in public/.
        importScripts: ['push-sw.js'],
        // Fonts come from Google; keep a copy so the app looks right offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 31_536_000 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // `wrangler dev` serves the API; same origin keeps the refresh cookie SameSite=Strict.
    proxy: { '/api': 'http://localhost:8787' },
  },
  // `vite preview` serves the built app with its service worker, for offline testing.
  preview: { port: 4173, proxy: { '/api': 'http://localhost:8787' } },
  test: {
    environment: 'jsdom',
    // `?raw` imports of CSS must return the source, not an empty module.
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
