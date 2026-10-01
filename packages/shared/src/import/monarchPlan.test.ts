import { describe, expect, it } from 'vitest';
import type { MonarchRow } from './adapters/monarch';
import {
  guessAccountKind,
  planMonarchImport,
  possibleDuplicates,
  toImportRows,
} from './monarchPlan';

const WINDOW = { from: '2023-01-01', to: '2026-08-31' };

const row = (o: Partial<MonarchRow> = {}): MonarchRow => ({
  sourceId: 'monarch:1',
  postedAt: '2025-05-05',
  amountCents: 1000,
  merchant: 'M',
  originalStatement: 'M',
  category: 'Groceries',
  account: 'Apple Card',
  notes: '',
  tags: [],
  reviewed: 'reviewed',
  ...o,
});

describe('guessAccountKind', () => {
  it.each([
    ['COLLEGE ACCESS LOAN (...3107-CL0001)', 'loan'],
    ['Current Mortgage (...0461)', 'loan'],
    ['Costco Anywhere Visa Card by Citi (...8182)', 'credit'],
    ['CREDIT CARD (...4905)', 'credit'],
    ['Apple Card', 'credit'],
    ['Apple Cash', 'depository'],
    ["Hannah's Savings (...9098)", 'depository'],
  ])('%s is %s', (name, kind) => expect(guessAccountKind(name)).toBe(kind));
});

describe('planMonarchImport scope', () => {
  it('keeps only the window, inclusive at both ends, and counts what it leaves out', () => {
    const plan = planMonarchImport(
      [
        row({ sourceId: 'a', postedAt: '2022-12-31' }),
        row({ sourceId: 'b', postedAt: '2023-01-01' }),
        row({ sourceId: 'c', postedAt: '2026-08-31' }),
        row({ sourceId: 'd', postedAt: '2026-09-01' }),
        row({ sourceId: 'e', category: 'Balance Adjustments' }),
        row({ sourceId: 'f', category: 'Balance Adjustments' }),
      ],
      [],
      [],
      WINDOW,
    );
    expect(plan.rows.map((r) => r.sourceId)).toEqual(['b', 'c']);
    expect(plan.skipped).toEqual({
      outsideWindow: 2,
      categories: { 'Balance Adjustments': 2 },
    });
  });
});

describe('planMonarchImport accounts', () => {
  const rows = [
    row({ account: 'USAA CLASSIC CHECKING (...1335)', postedAt: '2024-01-02' }),
    row({ account: 'USAA CLASSIC CHECKING (...1335)', postedAt: '2024-03-01', sourceId: 'x' }),
    row({ account: 'Apple Card', sourceId: 'y' }),
  ];

  it('matches by name ignoring case and spacing', () => {
    const plan = planMonarchImport(rows, [{ id: 'a1', name: ' apple  CARD ' }], [], WINDOW);
    expect(plan.accounts.find((a) => a.monarchName === 'Apple Card')).toMatchObject({
      matched: true,
      choice: { type: 'existing', accountId: 'a1' },
    });
  });

  it('matches by the account number when the name differs', () => {
    const plan = planMonarchImport(
      rows,
      [{ id: 'a2', name: 'USAA Checking (...1335)' }],
      [],
      WINDOW,
    );
    expect(plan.accounts[0]).toMatchObject({
      monarchName: 'USAA CLASSIC CHECKING (...1335)',
      rows: 2,
      first: '2024-01-02',
      last: '2024-03-01',
      matched: true,
      choice: { type: 'existing', accountId: 'a2' },
    });
  });

  it('will not guess between two accounts that fit', () => {
    const plan = planMonarchImport(
      rows,
      [
        { id: 'a2', name: 'Checking (...1335)' },
        { id: 'a3', name: 'Other (...1335)' },
        { id: 'a4', name: 'Apple Card' },
        { id: 'a5', name: 'apple card' },
      ],
      [],
      WINDOW,
    );
    expect(plan.accounts.every((a) => !a.matched)).toBe(true);
  });

  it('proposes a history-only account, with a guessed kind, when nothing matches', () => {
    const plan = planMonarchImport([row({ account: 'FIXED RATE LOAN (...5652)' })], [], [], WINDOW);
    expect(plan.accounts[0]).toMatchObject({
      matched: false,
      choice: { type: 'create', kind: 'loan' },
    });
  });

  it('has no account to match without a number or an exact name', () => {
    const plan = planMonarchImport(
      [row({ account: 'Savings' })],
      [{ id: 'z', name: 'Savings 2' }],
      [],
      WINDOW,
    );
    expect(plan.accounts[0]?.matched).toBe(false);
  });
});

describe('planMonarchImport categories', () => {
  it('matches existing categories by name and proposes creating the rest', () => {
    const plan = planMonarchImport(
      [
        row({ category: 'Groceries' }),
        row({ category: 'Groceries', sourceId: '2' }),
        row({ category: 'Gym', sourceId: '3' }),
      ],
      [],
      [
        { id: 'c1', name: 'groceries ' },
        { id: 'c2', name: 'Other' },
      ],
      WINDOW,
    );
    expect(plan.categories).toEqual([
      {
        monarchName: 'Groceries',
        rows: 2,
        matched: true,
        choice: { type: 'existing', categoryId: 'c1' },
      },
      { monarchName: 'Gym', rows: 1, matched: false, choice: { type: 'create', kind: 'expense' } },
    ]);
  });

  it('does not guess when two categories share the name', () => {
    const plan = planMonarchImport(
      [row()],
      [],
      [
        { id: 'c1', name: 'Groceries' },
        { id: 'c2', name: 'GROCERIES' },
      ],
      WINDOW,
    );
    expect(plan.categories[0]?.matched).toBe(false);
  });

  it('guesses income when every row is money in, transfer by name, otherwise expense', () => {
    const plan = planMonarchImport(
      [
        row({ category: 'Paychecks', amountCents: -500 }),
        row({ category: 'Paychecks', amountCents: -700, sourceId: '2' }),
        row({ category: 'Doctor', amountCents: -300, sourceId: '3' }),
        row({ category: 'Doctor', amountCents: 900, sourceId: '4' }),
        row({ category: 'Credit Card Payment', sourceId: '5' }),
        row({ category: 'transfer', sourceId: '6' }),
      ],
      [],
      [],
      WINDOW,
    );
    const kind = (n: string) => {
      const c = plan.categories.find((p) => p.monarchName === n)?.choice;
      return c?.type === 'create' ? c.kind : null;
    };
    expect(kind('Paychecks')).toBe('income');
    expect(kind('Doctor')).toBe('expense');
    expect(kind('Credit Card Payment')).toBe('transfer');
    expect(kind('transfer')).toBe('transfer');
  });

  it('lists the biggest first', () => {
    const plan = planMonarchImport(
      [
        row({ category: 'A' }),
        row({ category: 'B', sourceId: '2' }),
        row({ category: 'B', sourceId: '3' }),
      ],
      [],
      [],
      WINDOW,
    );
    expect(plan.categories.map((c) => c.monarchName)).toEqual(['B', 'A']);
  });
});

describe('toImportRows', () => {
  const accounts = new Map([['Apple Card', 'acc1']]);
  const categories = new Map([
    ['Groceries', 'cat1'],
    ['Transfer', 'cat2'],
  ]);

  it('attaches ids, marks transfers, and keeps Needs Review in the queue', () => {
    const { rows, unresolved } = toImportRows(
      [
        row(),
        row({ sourceId: '2', category: 'Transfer' }),
        row({ sourceId: '3', reviewed: 'needs_review' }),
        row({ sourceId: '4', reviewed: 'unreviewed' }),
      ],
      accounts,
      categories,
    );
    expect(unresolved).toBe(0);
    expect(rows.map((r) => [r.accountId, r.categoryId, r.isTransfer, r.reviewed])).toEqual([
      ['acc1', 'cat1', false, true],
      ['acc1', 'cat2', true, true],
      ['acc1', 'cat1', false, false],
      ['acc1', 'cat1', false, true],
    ]);
  });

  it('leaves out a row whose account or category was not resolved, and says so', () => {
    const { rows, unresolved } = toImportRows(
      [row({ account: 'Nope' }), row({ category: 'Nope', sourceId: '2' }), row({ sourceId: '3' })],
      accounts,
      categories,
    );
    expect(rows).toHaveLength(1);
    expect(unresolved).toBe(2);
  });
});

describe('possibleDuplicates', () => {
  it('groups identical account, day, amount and merchant, newest first, in file order', () => {
    const groups = possibleDuplicates([
      row({ sourceId: 'a', postedAt: '2026-06-01', merchant: 'Africa New Life' }),
      row({ sourceId: 'b', postedAt: '2026-08-01', merchant: 'Amazon' }),
      row({ sourceId: 'c', postedAt: '2026-06-01', merchant: ' africa  new life ' }),
      row({ sourceId: 'd', postedAt: '2026-08-01', merchant: 'Amazon' }),
      row({ sourceId: 'e', postedAt: '2026-08-01', merchant: 'Amazon' }),
    ]);
    expect(groups.map((g) => [g.postedAt, g.merchant, g.sourceIds])).toEqual([
      ['2026-08-01', 'Amazon', ['b', 'd', 'e']],
      ['2026-06-01', 'Africa New Life', ['a', 'c']],
    ]);
  });

  it('does not group rows that differ by account, day, amount or merchant', () => {
    expect(
      possibleDuplicates([
        row({ sourceId: 'a' }),
        row({ sourceId: 'b', account: 'Apple Cash' }),
        row({ sourceId: 'c', postedAt: '2025-05-06' }),
        row({ sourceId: 'd', amountCents: 1001 }),
        row({ sourceId: 'e', merchant: 'Other' }),
      ]),
    ).toEqual([]);
  });
});
