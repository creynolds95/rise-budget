import { describe, expect, it } from 'vitest';
import { checkAccounts } from './accountCheck';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const day = 86_400_000;
const base = {
  known: [
    { id: 'r1', sourceAccountId: 'a1', name: 'Checking' },
    { id: 'r2', sourceAccountId: 'a2', name: 'Savings' },
    { id: 'r3', sourceAccountId: 'a3', name: 'Card' },
  ],
  returned: [
    { id: 'a1', name: 'Checking', balanceDateMs: NOW - day },
    { id: 'a2', name: 'Savings', balanceDateMs: NOW - 2 * day },
  ],
  errors: [],
  errlist: [],
  nowMs: NOW,
};

describe('checkAccounts', () => {
  it('names an account the response left out', () => {
    expect(checkAccounts(base).missing).toEqual(['r3']);
  });

  it('flags an old balance only past the staleness floor', () => {
    const r = checkAccounts({
      ...base,
      returned: [
        { id: 'a1', name: 'Checking', balanceDateMs: NOW - 3 * day },
        { id: 'a2', name: 'Savings', balanceDateMs: NOW - 5 * day },
        { id: 'a3', name: 'Card', balanceDateMs: NOW - day },
      ],
    });
    expect(r.missing).toEqual([]);
    expect(r.stale.map((s) => s.id)).toEqual(['r2']);
  });

  it('attributes errlist entries to the account they name', () => {
    const r = checkAccounts({
      ...base,
      errlist: [
        { code: 'act.xxx', msg: 'Failed to get complete transaction set', account_id: 'a3' },
      ],
      errors: ['Failed to get complete transaction set'],
    });
    expect(r.errors).toEqual([
      { account: 'Card', message: 'Failed to get complete transaction set' },
    ]);
  });

  it('keeps an unattributed or unknown-account error, and plain strings not in errlist', () => {
    const r = checkAccounts({
      ...base,
      errlist: [{ msg: 'Connection needs re-auth', account_id: 'zzz' }],
      errors: ['Something else'],
    });
    expect(r.errors).toEqual([
      { message: 'Connection needs re-auth' },
      { message: 'Something else' },
    ]);
  });

  it('is quiet when everything came back fresh', () => {
    const r = checkAccounts({ ...base, known: base.known.slice(0, 2) });
    expect(r).toEqual({ missing: [], stale: [], errors: [] });
  });
});
