import type { AccountPlan, CategoryPlan, DuplicateGroup, ImportRow } from '@rise/shared/import';
import { describe, expect, it } from 'vitest';
import {
  chunk,
  duplicateKey,
  needGroup,
  resolveIds,
  setupBody,
  skippedIds,
  withoutSkipped,
} from './monarchImport';

const acct = (monarchName: string, choice: AccountPlan['choice']): AccountPlan => ({
  monarchName,
  rows: 1,
  first: '2023-01-01',
  last: '2023-01-02',
  matched: choice.type === 'existing',
  choice,
});
const cat = (monarchName: string, choice: CategoryPlan['choice']): CategoryPlan => ({
  monarchName,
  rows: 1,
  matched: choice.type === 'existing',
  choice,
});

describe('chunk', () => {
  it('splits into fixed-size pieces, last one short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('setupBody', () => {
  const accounts = [
    acct('Old Card', { type: 'create', kind: 'credit' }),
    acct('Checking', { type: 'existing', accountId: 'a1' }),
  ];
  const categories = [
    cat('Gym', { type: 'create', kind: 'expense' }),
    cat('Groceries', { type: 'existing', categoryId: 'c1' }),
  ];
  it('asks to create only what is set to new', () => {
    expect(setupBody(accounts, categories, {}, {})).toEqual({
      accounts: [{ monarchName: 'Old Card', kind: 'credit' }],
      categories: [{ monarchName: 'Gym', kind: 'expense' }],
    });
  });
  it('follows the person’s edits', () => {
    expect(
      setupBody(
        accounts,
        categories,
        { 'Old Card': { type: 'existing', accountId: 'a2' } },
        {
          Gym: { type: 'existing', categoryId: 'c2' },
          Groceries: { type: 'create', kind: 'income' },
        },
      ),
    ).toEqual({ accounts: [], categories: [{ monarchName: 'Groceries', kind: 'income' }] });
  });
});

describe('setupBody groups', () => {
  const cats = [
    cat('Gym', { type: 'create', kind: 'expense' }),
    cat('Payroll', { type: 'create', kind: 'transfer' }),
  ];
  it('sends the picked group, except for transfers', () => {
    expect(setupBody([], cats, {}, {}, { Gym: 'g1', Payroll: 'g1' }).categories).toEqual([
      { monarchName: 'Gym', kind: 'expense', groupId: 'g1' },
      { monarchName: 'Payroll', kind: 'transfer' },
    ]);
  });
});

describe('resolveIds', () => {
  it('uses existing ids and created ids; leaves unresolved out', () => {
    const plans = [
      cat('A', { type: 'existing', categoryId: 'c1' }),
      cat('B', { type: 'create', kind: 'expense' }),
      cat('C', { type: 'create', kind: 'expense' }),
    ];
    const ids = resolveIds(plans, {}, { B: 'c2' });
    expect([...ids]).toEqual([
      ['A', 'c1'],
      ['B', 'c2'],
    ]);
    const accounts = resolveIds([acct('X', { type: 'existing', accountId: 'a1' })], {}, {});
    expect(accounts.get('X')).toBe('a1');
  });
});

describe('duplicate skipping', () => {
  const g: DuplicateGroup = {
    account: 'A',
    postedAt: '2024-01-01',
    amountCents: 500,
    merchant: 'Gift',
    sourceIds: ['monarch:1', 'monarch:2', 'monarch:3'],
  };
  it('keeps the first of a ticked group and everything in an unticked one', () => {
    expect([...skippedIds([g], new Set())]).toEqual([]);
    expect([...skippedIds([g], new Set([duplicateKey(g)]))]).toEqual(['monarch:2', 'monarch:3']);
  });
  it('drops skipped rows from the batch', () => {
    const rows = [{ sourceId: 'monarch:1' }, { sourceId: 'monarch:2' }] as ImportRow[];
    expect(withoutSkipped(rows, new Set(['monarch:2'])).map((r) => r.sourceId)).toEqual([
      'monarch:1',
    ]);
  });
});

describe('needGroup', () => {
  const cats = [
    cat('Work expenses', { type: 'create', kind: 'expense' }),
    cat('Payroll', { type: 'create', kind: 'transfer' }),
    cat('Groceries', { type: 'existing', categoryId: 'c1' }),
  ];
  it('lists new income/expense categories without a group', () => {
    expect(needGroup(cats, {}, {})).toEqual(['Work expenses']);
    expect(needGroup(cats, {}, { 'Work expenses': 'g1' })).toEqual([]);
  });
  it('stops asking once a category is folded into an existing one', () => {
    expect(
      needGroup(cats, { 'Work expenses': { type: 'existing', categoryId: 'c2' } }, {}),
    ).toEqual([]);
  });
});
