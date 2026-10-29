import { afterEach, describe, expect, it } from 'vitest';
import {
  WELCOME_STEPS,
  clampStep,
  finishWelcome,
  saveStep,
  savedStep,
  shouldOpenWelcome,
  welcomeDone,
} from './welcome';

describe('first-run guide', () => {
  afterEach(() => localStorage.clear());

  it('opens only for an install with no accounts that has not finished it', () => {
    expect(shouldOpenWelcome(0, false)).toBe(true);
    expect(shouldOpenWelcome(0, true)).toBe(false);
    expect(shouldOpenWelcome(3, false)).toBe(false);
    // Still loading: never jump on a guess.
    expect(shouldOpenWelcome(undefined, false)).toBe(false);
  });

  it('keeps the step in range', () => {
    expect(clampStep(null)).toBe(0);
    expect(clampStep('2')).toBe(2);
    expect(clampStep(String(WELCOME_STEPS))).toBe(0);
    expect(clampStep('-1')).toBe(0);
    expect(clampStep('1.5')).toBe(0);
  });

  it('remembers the step until finished', () => {
    saveStep(2);
    expect(savedStep()).toBe(2);
    expect(welcomeDone()).toBe(false);
    finishWelcome();
    expect(welcomeDone()).toBe(true);
    expect(savedStep()).toBe(0);
  });
});
