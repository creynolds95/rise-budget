import { api } from './api';

/**
 * Push on this device (SPEC §8.2). iPhone only offers it to the app added to the Home Screen;
 * elsewhere it needs a service worker and the Push API.
 */
export type PushSupport = 'ok' | 'install' | 'no';

export function pushSupport(
  w: Pick<Window, 'matchMedia'> & { navigator: Navigator } = window,
): PushSupport {
  const standalone =
    w.matchMedia('(display-mode: standalone)').matches ||
    (w.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apple = /iPhone|iPad|iPod/.test(w.navigator.userAgent);
  if (apple && !standalone) return 'install';
  if (!('serviceWorker' in w.navigator) || !('PushManager' in globalThis)) return 'no';
  return 'ok';
}

/** The base64url key as the bytes `applicationServerKey` wants. */
export function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration()).pushManager.getSubscription();
}

/** Ask, subscribe, and tell the server. False when the owner said no. */
export async function enablePush(): Promise<boolean> {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const { publicKey } = await api<{ publicKey: string }>('GET', '/push/key');
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON();
  await api('POST', '/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('DELETE', '/push/subscriptions', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
