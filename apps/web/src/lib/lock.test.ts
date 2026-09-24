import { beforeEach, describe, expect, it } from 'vitest';
import { PIN_MAX_FAILS, checkPin, clearPin, hasPin, pinFails, setPin, shouldLock } from './lock';

describe('shouldLock', () => {
  const now = 10_000_000;
  it('never locks when off', () => {
    expect(shouldLock('off', null, now)).toBe(false);
    expect(shouldLock('off', 0, now)).toBe(false);
  });
  it('locks on any return when immediate', () => {
    expect(shouldLock('immediate', now, now)).toBe(true);
  });
  it('waits out the chosen time', () => {
    expect(shouldLock('5m', now - 4 * 60_000, now)).toBe(false);
    expect(shouldLock('5m', now - 5 * 60_000, now)).toBe(true);
    expect(shouldLock('1h', now - 59 * 60_000, now)).toBe(false);
    expect(shouldLock('1h', now - 60 * 60_000, now)).toBe(true);
  });
  it('locks when it has no record of the app being put away', () => {
    expect(shouldLock('1h', null, now)).toBe(true);
  });
});

describe('PIN', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores only a hash and checks it', async () => {
    await setPin('4821');
    expect(hasPin()).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain('4821');
    expect(await checkPin('4821')).toBe('ok');
    expect(await checkPin('0000')).toBe('wrong');
    expect(pinFails()).toBe(1);
    expect(await checkPin('4821')).toBe('ok');
    expect(pinFails()).toBe(0);
  });

  it('rejects PINs that are not 4 to 8 digits', async () => {
    await expect(setPin('123')).rejects.toThrow();
    await expect(setPin('12a4')).rejects.toThrow();
  });

  it('wipes itself after too many wrong tries', async () => {
    await setPin('4821');
    for (let i = 1; i < PIN_MAX_FAILS; i++) expect(await checkPin('1111')).toBe('wrong');
    expect(await checkPin('1111')).toBe('wiped');
    expect(hasPin()).toBe(false);
    expect(await checkPin('4821')).toBe('wiped');
  });

  it('clears', async () => {
    await setPin('4821');
    clearPin();
    expect(hasPin()).toBe(false);
  });
});
