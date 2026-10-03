import { describe, expect, it } from 'vitest';
import { accountBadge } from './institution';

const synced = (institutionName: string | null, kind = 'credit' as const) => ({
  name: 'X',
  kind,
  source: 'simplefin',
  institutionName,
});

describe('accountBadge', () => {
  it('matches known banks by institution name', () => {
    expect(accountBadge(synced('Chase Bank'))).toEqual({ type: 'brand', mark: 'chase' });
    expect(accountBadge(synced('Apple Card'))).toEqual({ type: 'brand', mark: 'apple' });
    expect(accountBadge(synced('USAA'))).toMatchObject({ type: 'word', text: 'USAA' });
    expect(accountBadge(synced('Citibank'))).toMatchObject({ type: 'word', text: 'citi' });
  });

  it('does not mistake look-alike names', () => {
    expect(accountBadge(synced('Citizens Bank'))).toEqual({ type: 'initials', text: 'CB' });
    expect(accountBadge(synced('Purchase FCU'))).toEqual({ type: 'initials', text: 'PF' });
  });

  it('falls back to initials, or a glyph for loans and manual accounts', () => {
    expect(accountBadge(synced('Ally'))).toEqual({ type: 'initials', text: 'AL' });
    expect(
      accountBadge(synced('Texas Higher Education Coordinating Board', 'loan' as never)),
    ).toMatchObject({ type: 'word', text: 'THECB' });
    expect(accountBadge(synced('Nelnet', 'loan' as never))).toEqual({ type: 'glyph', icon: 'doc' });
    expect(
      accountBadge({ name: 'Car', kind: 'other', source: 'manual', institutionName: null }),
    ).toEqual({ type: 'glyph', icon: 'home' });
    expect(accountBadge(synced(null))).toEqual({ type: 'glyph', icon: 'card' });
  });

  it('matches manual accounts on their own name', () => {
    expect(
      accountBadge({ name: 'Zillow home', kind: 'other', source: 'manual', institutionName: null }),
    ).toEqual({ type: 'brand', mark: 'zillow' });
  });

  it('badges student loans and retirement plans', () => {
    const manual = (name: string) => ({
      name,
      kind: 'loan' as const,
      source: 'manual',
      institutionName: null,
    });
    expect(accountBadge(manual('Fed Loan 1-03'))).toMatchObject({ type: 'word', text: 'M' });
    expect(accountBadge(manual('CL0004'))).toMatchObject({ type: 'word', text: 'THECB' });
    expect(accountBadge(manual('Mortgage'))).toEqual({ type: 'glyph', icon: 'doc' });
    expect(accountBadge(synced('GuideStone Financial Resources'))).toMatchObject({ text: 'GS' });
    expect(accountBadge(synced('Empower Retirement'))).toMatchObject({ text: 'E' });
  });
});
