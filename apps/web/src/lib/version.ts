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

/** Pull the new service worker, then reload onto the new build. */
export async function updateApp(): Promise<void> {
  const reload = () => window.location.reload();
  const sw = navigator.serviceWorker;
  const reg = await sw?.getRegistration().catch(() => undefined);
  if (!sw || !reg) return reload();
  sw.addEventListener('controllerchange', reload, { once: true });
  // The new worker skips waiting and claims the page; reload anyway if it never does.
  setTimeout(reload, 4000);
  await reg.update().catch(reload);
}
