import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiError, onAuthChange } from './lib/api';
import { AuthProvider } from './lib/auth';
import './styles.css';

/**
 * How long cached reads stay usable offline. It is also the query gcTime, which feeds
 * setTimeout — so it must stay under 2^31 ms (~24.8 days) or it fires at once and empties
 * the cache the moment it is restored.
 */
const CACHE_MAX_AGE = 14 * 24 * 3600_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Kept as long as the persisted copy, or a cold start offline would find nothing.
      gcTime: CACHE_MAX_AGE,
      retry: (n, e) => !(e instanceof ApiError && e.status > 0 && e.status < 500) && n < 2,
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'rise-query-cache',
  throttleTime: 2000,
});

// Signing out takes this device's copy of the data with it.
onAuthChange((signedIn) => {
  if (signedIn) return;
  queryClient.clear();
  void persister.removeClient();
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: __APP_VERSION__ }}
    >
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);

// The static splash in index.html covers the parse/execute gap; fade it out now that React
// has mounted. On a warm cache that gap can be a handful of milliseconds — too fast to
// register as a splash at all — so it's held for a minimum stretch regardless of how fast
// the app actually mounted.
const MIN_SPLASH_MS = 500;
requestAnimationFrame(() => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const elapsed = Date.now() - (window.__splashStart ?? Date.now());
  setTimeout(
    () => {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 300);
    },
    Math.max(0, MIN_SPLASH_MS - elapsed),
  );
});
