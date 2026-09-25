import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  SimpleFinAccountSet,
  decimalToCents,
  localDate,
  toIncomingAccount,
  toIncomingTxn,
  type SimpleFinAccount,
} from './simplefin';

const TZ = 'America/Chicago';
// 2026-09-10 03:00 UTC = 2026-09-09 22:00 in Chicago.
const LATE_EVENING = Date.UTC(2026, 8, 10, 3) / 1000;

const account = (over: Partial<SimpleFinAccount> = {}): SimpleFinAccount => ({
  org: { name: 'USAA' },
  id: 'ACT-1',
  name: 'USAA Checking',
  currency: 'USD',
  balance: '1523.07',
  'balance-date': LATE_EVENING,
  transactions: [],
  ...over,
});

describe('SimpleFIN adapter (SPEC §6.1, §6.3)', () => {
  it('parses decimal strings exactly, never through floats', () => {
    expect(decimalToCents('0.1')).toBe(10);
    expect(decimalToCents('-12.34')).toBe(-1_234);
    expect(decimalToCents('+5')).toBe(500);
    expect(decimalToCents('1234567.89')).toBe(123_456_789);
    expect(decimalToCents('3.100')).toBe(310);
  });

  it('refuses sub-cent amounts and garbage rather than rounding', () => {
    expect(() => decimalToCents('3.105')).toThrow(AdapterError);
    expect(() => decimalToCents('1e3')).toThrow(AdapterError);
    expect(() => decimalToCents('99999999999999999')).toThrow(/range/);
  });

  it('dates a transaction in the user’s timezone', () => {
    expect(localDate(LATE_EVENING, TZ)).toBe('2026-09-09');
    expect(localDate(LATE_EVENING, 'UTC')).toBe('2026-09-10');
  });

  it('flips transaction signs: money out is spending, positive in Rise', () => {
    const t = toIncomingTxn(
      { id: 'T1', posted: LATE_EVENING, amount: '-42.10', description: ' KROGER #512 ' },
      TZ,
    );
    expect(t).toEqual({
      sourceId: 'T1',
      postedAt: '2026-09-09',
      amountCents: 4_210,
      descriptor: 'KROGER #512',
      pending: false,
    });
    const pay = toIncomingTxn(
      { id: 'T2', posted: LATE_EVENING, amount: '2500.00', description: 'PAYROLL' },
      TZ,
    );
    expect(pay.amountCents).toBe(-250_000);
  });

  it('treats posted=0 as pending, dated by transacted_at; falls back to payee', () => {
    expect(
      toIncomingTxn(
        {
          id: 'P',
          posted: 0,
          transacted_at: LATE_EVENING,
          amount: '-1',
          description: '',
          payee: 'Shell',
        },
        TZ,
      ),
    ).toMatchObject({ pending: true, postedAt: '2026-09-09', descriptor: 'Shell' });
    expect(
      toIncomingTxn(
        { id: 'P', posted: LATE_EVENING, amount: '-1', description: ' ', pending: true },
        TZ,
      ),
    ).toMatchObject({ pending: true, descriptor: 'Unknown' });
    expect(
      toIncomingTxn({ id: 'P', posted: 0, amount: '-1', description: 'x' }, 'UTC').postedAt,
    ).toBe('1970-01-01');
  });

  it('guesses kind for Caleb’s accounts; savings stay out of the budget; Apple is monthly', () => {
    const g = (name: string, org: string, balance = '100.00') =>
      toIncomingAccount(account({ name, org: { name: org }, balance }), TZ);
    expect(g('USAA Checking', 'USAA')).toMatchObject({
      kind: 'depository',
      includeInBudget: true,
      syncCadenceHours: 24,
    });
    expect(g('USAA Savings', 'USAA')).toMatchObject({ kind: 'depository', includeInBudget: false });
    expect(g('USAA Rewards Visa', 'USAA', '-812.44')).toMatchObject({
      kind: 'credit',
      balanceCents: -81_244,
    });
    expect(g('Chase Freedom', 'Chase', '-12.00')).toMatchObject({ kind: 'credit' });
    expect(g('Citi Double Cash Card', 'Citi', '0.00')).toMatchObject({
      kind: 'credit',
      includeInBudget: true,
    });
    expect(g('Apple Card', 'Apple')).toMatchObject({ kind: 'credit', syncCadenceHours: 720 });
    expect(g('Apple Savings', 'Apple')).toMatchObject({
      kind: 'depository',
      includeInBudget: false,
      syncCadenceHours: 720,
    });
    expect(g('Auto Loan', 'USAA', '-9000.00')).toMatchObject({ kind: 'loan' });
    expect(g('Fidelity 401(k)', 'Fidelity', '50000.00')).toMatchObject({
      kind: 'investment',
      includeInBudget: false,
    });
    expect(toIncomingAccount(account({ org: { domain: 'usaa.com' } }), TZ).institutionName).toBe(
      'usaa.com',
    );
    expect(toIncomingAccount(account({ org: {} }), TZ).institutionName).toBeNull();
  });

  it('refuses non-USD accounts', () => {
    expect(() =>
      toIncomingAccount(account({ currency: 'https://example.com/points' }), TZ),
    ).toThrow(/currency/);
  });

  it('validates the wire format', () => {
    const ok = SimpleFinAccountSet.parse({ accounts: [{ ...account(), transactions: undefined }] });
    expect(ok.errors).toEqual([]);
    expect(ok.accounts[0]?.transactions).toEqual([]);
    expect(
      SimpleFinAccountSet.safeParse({ accounts: [{ ...account(), balance: 'lots' }] }).success,
    ).toBe(false);
  });
});
