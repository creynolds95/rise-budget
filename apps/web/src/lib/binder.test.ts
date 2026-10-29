import { describe, expect, it } from 'vitest';
import { binderSections, blankEntry } from './binder';

const acct = (
  id: string,
  name: string,
  mask: string | null = null,
  archivedAt: string | null = null,
) => ({
  id,
  name,
  mask,
  archivedAt,
});

describe('binder', () => {
  it('lists every open account, with what has been written about it', () => {
    const e = { ...blankEntry('account', { id: 'a1', name: 'Checking' }), phone: '800-555-0100' };
    const s = binderSections({ passwordsLiveIn: '', entries: [e] }, [
      acct('a1', 'Checking', '1234'),
      acct('a2', 'Card'),
      acct('a3', 'Old', null, '2026-01-01T00:00:00Z'),
    ]);
    const accounts = s.find((x) => x.kind === 'account');
    expect(accounts?.rows.map((r) => [r.title, r.detail, r.entry?.id ?? null])).toEqual([
      ['Checking', '••1234 · 800-555-0100', e.id],
      ['Card', '', null],
    ]);
  });

  it('files other entries by kind, last four over the bank mask', () => {
    const policy = {
      ...blankEntry('insurance'),
      title: 'Home policy',
      last4: '9876',
      website: 'insurer.example',
      location: 'Fire safe',
    };
    const loose = { ...blankEntry('account'), title: 'Old 401k' };
    const s = binderSections({ passwordsLiveIn: '', entries: [policy, loose] }, []);
    expect(s.find((x) => x.kind === 'insurance')?.rows[0]?.detail).toBe(
      '••9876 · insurer.example · Fire safe',
    );
    expect(s.find((x) => x.kind === 'account')?.rows.map((r) => r.title)).toEqual(['Old 401k']);
    expect(s.map((x) => x.title)).toEqual([
      'Accounts',
      'Insurance',
      'People to call',
      'Documents',
      'Other',
    ]);
  });
});
