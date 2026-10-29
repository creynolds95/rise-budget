import { describe, expect, it } from 'vitest';
import { budgetedInGroup, isTransfersGroup } from './transfers';

describe('Transfers group is never spending', () => {
  it('matches the Transfers group by name, ignoring case and spaces', () => {
    expect(isTransfersGroup('Transfers')).toBe(true);
    expect(isTransfersGroup(' transfers ')).toBe(true);
    expect(isTransfersGroup('Transfer')).toBe(false);
    expect(isTransfersGroup('Home')).toBe(false);
    expect(isTransfersGroup(undefined)).toBe(false);
    expect(isTransfersGroup(null)).toBe(false);
  });

  it('a category in Transfers is unbudgeted even when asked to count', () => {
    expect(budgetedInGroup('Transfers', true)).toBe(false);
    expect(budgetedInGroup('Transfers', false)).toBe(false);
    expect(budgetedInGroup('Home', true)).toBe(true);
    expect(budgetedInGroup('Home', false)).toBe(false);
  });
});
