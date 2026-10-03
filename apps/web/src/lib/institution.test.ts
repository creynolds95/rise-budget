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
    ).toEqual({ type: 'glyph', icon: 'doc' });
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
});
