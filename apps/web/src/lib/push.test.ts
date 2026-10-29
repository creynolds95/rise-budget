import { describe, expect, it } from 'vitest';
import { keyBytes, pushSupport } from './push';

const win = (ua: string, standalone: boolean) => ({
  matchMedia: (() => ({ matches: standalone })) as unknown as Window['matchMedia'],
  navigator: { userAgent: ua, serviceWorker: {} } as unknown as Navigator,
});

describe('push support', () => {
  it('asks iPhone to add Rise to the Home Screen first', () => {
    expect(pushSupport(win('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', false))).toBe('install');
  });

  it('decodes the base64url key', () => {
    expect([...keyBytes('AQID_w')]).toEqual([1, 2, 3, 255]);
  });
});
