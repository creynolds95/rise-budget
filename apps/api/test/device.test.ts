import { describe, expect, it } from 'vitest';
import { deviceLabel } from '../src/lib/device';

describe('deviceLabel', () => {
  it.each([
    [undefined, null],
    ['curl/8.0', null],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      'iPhone · Safari',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/130 Mobile Safari/604.1',
      'iPad · Chrome',
    ],
    ['Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36', 'Android · Chrome'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
      'Mac · Safari',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Windows · Edge',
    ],
    ['Mozilla/5.0 (X11; CrOS x86_64 15000.0) Chrome/130.0 Safari/537.36', 'Chromebook · Chrome'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Linux · Firefox'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
