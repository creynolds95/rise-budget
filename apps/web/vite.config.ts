import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // `wrangler dev` serves the API; same origin keeps the refresh cookie SameSite=Strict.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    // `?raw` imports of CSS must return the source, not an empty module.
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
