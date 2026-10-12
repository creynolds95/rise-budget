import { describe, expect, it } from 'vitest';
import { PUSH_DEFAULTS, type PushSettings } from '../schemas/entities';
import { dollars, MAX_NOTICES_PER_RUN, notices, toSend, type NoticeInputs } from './notices';

const ALL: PushSettings = {
  recap: true,
  missedBill: true,
  bankTrouble: true,
  priceUp: true,
  doubleCharge: true,
  duplicate: true,
  unusual: true,
  firstTime: true,
  surplusNegative: true,
  toReview: true,
  paycheck: true,
  manualLoan: true,
};
const series = (p: Partial<NoticeInputs['series'][number]> = {}) => ({
  id: 's1',
  name: 'Streamflix',
  status: 'active',
  expectedAmountCents: 1_799,
  nextExpectedDate: '2026-11-03',
  previousAmountCents: null,
  priceChangedOn: null,
  doubleChargedOn: null,
  ...p,
});
const input: NoticeInputs = {
  series: [
    series({
      previousAmountCents: 1_599,
      priceChangedOn: '2026-10-03',
      doubleChargedOn: '2026-10-05',
    }),
    series({ id: 's2', name: 'Gym', status: 'broken', nextExpectedDate: '2026-10-01' }),
  ],
  flags: [
    { id: 't1', name: 'Corner Garage', amountCents: 4_250, flag: 'duplicate' },
    { id: 't2', name: 'Big Store', amountCents: 160_000, flag: 'unusual' },
    { id: 't3', name: 'New Place', amountCents: 45_000, flag: 'first_time' },
  ],
  bankTrouble: { key: 'acct1', message: 'Example Bank needs you to sign in again.' },
  recap: { weekOf: '2026-10-04', spentCents: 123_456, toReview: 3 },
  surplusNegative: { shortfallCents: 25_050, date: '2026-10-12' },
  review: { runId: 'run1', count: 12 },
  paychecks: [],
  deposits: [],
  balanceMoves: [],
  minCents: 10_000,
};

describe('notices', () => {
  it('skips the review count at zero and the Surplus alert when fine', () => {
    const n = notices(
      { ...input, surplusNegative: null, review: { runId: 'r', count: 0 } },
      { ...ALL, recap: false },
    ).map((x) => x.key);
    expect(n).not.toContain('surplus:negative');
    expect(n.some((k) => k.startsWith('review:'))).toBe(false);
    expect(notices({ ...input, review: null }, ALL).some((x) => x.key.startsWith('review:'))).toBe(
      false,
    );
  });

  it('words every kind the owner allows', () => {
    const n = notices(input, ALL);
    expect(n.map((x) => x.key)).toEqual([
      'bank:acct1',
      'price:s1:2026-10-03',
      'double:s1:2026-10-05',
      'missed:s2:2026-10-01',
      'flag:t1',
      'flag:t2',
      'flag:t3',
      'recap:2026-10-04',
      'surplus:negative',
      'review:run1',
    ]);
    expect(n[1]).toMatchObject({ title: 'Streamflix went up', body: 'Now $17.99, was $15.99.' });
    expect(n[3]?.body).toBe('It was due 10/01.');
    expect(n[6]).toMatchObject({ title: 'Large first charge', url: '/transactions/t3' });
    expect(n[7]).toMatchObject({ body: '$1,234.56 spent · 3 to review', url: '/review' });
    expect(n[8]).toMatchObject({
      title: 'Surplus is going negative',
      body: '$250.50 short around 10/12.',
    });
    expect(n[9]).toMatchObject({ title: '12 to review', url: '/review' });
  });

  it('tells paychecks, deposits and balance moves, skipping the small and the switched off', () => {
    const money: NoticeInputs = {
      ...input,
      series: [],
      flags: [],
      bankTrouble: null,
      recap: null,
      surplusNegative: null,
      review: null,
      paychecks: [
        { id: 'p1', name: 'Example Employer', amountCents: 250_000 },
        { id: 'p2', name: 'Refund', amountCents: 2_000 },
      ],
      deposits: [
        { id: 'd1', account: '401k', amountCents: 80_000 },
        { id: 'd2', account: '401k', amountCents: 5_000 },
      ],
      balanceMoves: [
        {
          accountId: 'a1',
          account: 'Checking',
          asOf: '2026-10-08',
          balanceCents: 500_000,
          deltaCents: 120_000,
          manualLoan: false,
        },
        {
          accountId: 'a2',
          account: 'Checking',
          asOf: '2026-10-08',
          balanceCents: 400_000,
          deltaCents: -30_000,
          manualLoan: false,
        },
        {
          accountId: 'a3',
          account: 'Checking',
          asOf: '2026-10-08',
          balanceCents: 400_100,
          deltaCents: 100,
          manualLoan: false,
        },
        {
          accountId: 'l1',
          account: 'Car loan',
          asOf: '2026-10-08',
          balanceCents: -900_000,
          deltaCents: 30_000,
          manualLoan: true,
        },
        {
          accountId: 'l2',
          account: 'Car loan',
          asOf: '2026-10-09',
          balanceCents: -900_050,
          deltaCents: -50,
          manualLoan: true,
        },
      ],
    };
    const n = notices(money, ALL);
    expect(n.map((x) => x.key)).toEqual([
      'pay:p1',
      'dep:d1',
      'bal:a1:2026-10-08:500000',
      'bal:a2:2026-10-08:400000',
      'bal:l1:2026-10-08:-900000',
      'bal:l2:2026-10-09:-900050',
    ]);
    expect(n[0]).toMatchObject({ title: 'Paycheck landed', body: 'Example Employer, $2,500.00' });
    expect(n[1]).toMatchObject({ title: 'Deposit to 401k', body: '$800.00' });
    expect(n[2]).toMatchObject({ title: 'Checking went up', body: '+$1,200.00, now $5,000.00' });
    expect(n[3]).toMatchObject({ title: 'Checking went down', body: '-$300.00, now $4,000.00' });
    expect(n[4]).toMatchObject({ title: 'Car loan paid down', body: '+$300.00, now $9,000.00' });
    const off = notices(money, { ...ALL, paycheck: false, manualLoan: false });
    expect(off.map((x) => x.key)).toEqual([
      'dep:d1',
      'bal:a1:2026-10-08:500000',
      'bal:a2:2026-10-08:400000',
    ]);
  });

  it('keeps the quiet kinds off by default', () => {
    const n = notices(input, PUSH_DEFAULTS);
    expect(n.map((x) => x.key)).toEqual(['bank:acct1', 'missed:s2:2026-10-01', 'recap:2026-10-04']);
    const calm = notices(
      { ...input, bankTrouble: null, recap: { weekOf: 'w', spentCents: 0, toReview: 0 } },
      PUSH_DEFAULTS,
    );
    expect(calm.at(-1)).toMatchObject({ body: '$0.00 spent · Nothing to review', url: '/' });
    const quiet = notices(input, { ...PUSH_DEFAULTS, recap: false, bankTrouble: false });
    expect(quiet.map((x) => x.key)).toEqual(['missed:s2:2026-10-01']);
  });

  it('sends only what is new, a few at a time, and marks the rest', () => {
    const n = notices(input, ALL);
    const r = toSend(n, new Set(['bank:acct1']));
    expect(r.send).toHaveLength(MAX_NOTICES_PER_RUN);
    expect(r.mark).toHaveLength(n.length - 1);
    expect(r.send[0]?.key).toBe('price:s1:2026-10-03');
  });

  it('formats dollars', () => {
    expect(dollars(5)).toBe('$0.05');
    expect(dollars(-1_234_500)).toBe('$12,345.00');
  });
});
