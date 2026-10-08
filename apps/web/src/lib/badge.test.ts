import { describe, expect, it, vi } from 'vitest';
import { setBadge } from './badge';

describe('setBadge', () => {
  it('sets the count when something waits', () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn() };
    setBadge(5, nav);
    expect(nav.setAppBadge).toHaveBeenCalledWith(5);
    expect(nav.clearAppBadge).not.toHaveBeenCalled();
  });
  it('clears at zero', () => {
    const nav = { setAppBadge: vi.fn(), clearAppBadge: vi.fn().mockResolvedValue(undefined) };
    setBadge(0, nav);
    expect(nav.clearAppBadge).toHaveBeenCalled();
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });
  it('does nothing where badges are unsupported, and swallows rejection', () => {
    expect(() => setBadge(3, {})).not.toThrow();
    expect(() => setBadge(3, { setAppBadge: () => Promise.reject(new Error('no')) })).not.toThrow();
  });
});
