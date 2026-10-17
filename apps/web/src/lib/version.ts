import { useEffect, useState } from 'react';

export interface Build {
  version: string;
  commit: string;
}

export const RUNNING: Build = { version: __APP_VERSION__, commit: __APP_COMMIT__ };

/** True when the deployed build differs from the one running. */
export function isStale(running: Build, latest: Build): boolean {
  return running.version !== latest.version || running.commit !== latest.commit;
}

/** The latest deployed build, or null while unknown (offline, dev server). */
export function useLatestBuild(): Build | null {
  const [latest, setLatest] = useState<Build | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Build>) : null))
      .then((b) => {
        if (live && b && typeof b.version === 'string' && typeof b.commit === 'string')
          setLatest(b);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return latest;
}

const TRIED = 'rise-update-tried';

/** Wait for a worker to finish installing and take over, or give up after `ms`. */
function activated(worker: ServiceWorker, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state === 'activated') return resolve();
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve();
    });
    setTimeout(resolve, ms);
  });
}

/**
 * Pull the new service worker, then reload onto the new build. `reg.update()` resolves once
 * the worker script is fetched, not once it is installed, so reloading right after it would
 * be served the old precached shell by the old worker. Wait for activation first. If a
 * previous tap this session still left the app stale, drop the worker and its caches.
 */
export async function updateApp(): Promise<void> {
  const reload = () => window.location.reload();
  const sw = navigator.serviceWorker;
  const reg = await sw?.getRegistration().catch(() => undefined);
  if (!sw || !reg) return reload();
  let retry = false;
  try {
    retry = sessionStorage.getItem(TRIED) !== null;
    sessionStorage.setItem(TRIED, '1');
  } catch {
    /* storage blocked: fall through to the normal path */
  }
  if (retry) {
    await reg.unregister().catch(() => false);
    const keys = await caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.map((k) => caches.delete(k)));
    return reload();
  }
  await reg.update().catch(() => {});
  const worker = reg.installing ?? reg.waiting;
  if (worker) await activated(worker, 15_000);
  reload();
}
