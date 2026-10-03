import type { AccountKind } from '@rise/shared/schemas';
import type { BrandMark } from './brandMarks';

/** What sits in the round badge left of an account's name. */
export type AccountBadge =
  | { type: 'brand'; mark: BrandMark }
  | { type: 'word'; text: string; color: string }
  | { type: 'initials'; text: string }
  | { type: 'glyph'; icon: 'bank' | 'card' | 'doc' | 'home' | 'wallet' };

// Order matters: the first pattern that matches wins. Word boundaries keep "citi" off
// "Citizens" and "chase" off "purchase".
const BRANDS: [RegExp, AccountBadge][] = [
  [/\bchase\b/, { type: 'brand', mark: 'chase' }],
  [/\bapple\b/, { type: 'brand', mark: 'apple' }],
  [/\bzillow\b/, { type: 'brand', mark: 'zillow' }],
  [/\b(american express|amex)\b/, { type: 'brand', mark: 'amex' }],
  [/\bbank of america\b/, { type: 'brand', mark: 'bofa' }],
  [/\bwells fargo\b/, { type: 'brand', mark: 'wellsfargo' }],
  [/\bdiscover\b/, { type: 'brand', mark: 'discover' }],
  [/\bpaypal\b/, { type: 'brand', mark: 'paypal' }],
  [/\bvenmo\b/, { type: 'brand', mark: 'venmo' }],
  // No free vector mark for these two; their colors and a wordmark read close enough.
  [/\busaa\b/, { type: 'word', text: 'USAA', color: '#12395B' }],
  [/\bciti(bank)?\b/, { type: 'word', text: 'citi', color: '#056DAE' }],
];

const KIND_GLYPH: Record<AccountKind, Extract<AccountBadge, { type: 'glyph' }>['icon']> = {
  depository: 'bank',
  credit: 'card',
  loan: 'doc',
  investment: 'wallet',
  other: 'home',
};

export function accountBadge(a: {
  name: string;
  kind: AccountKind;
  source: string;
  institutionName: string | null;
}): AccountBadge {
  // Synced accounts are matched on their bank; manual ones on whatever the user named them.
  const hay = (a.institutionName ?? (a.source === 'manual' ? a.name : '')).toLowerCase();
  for (const [re, badge] of BRANDS) if (re.test(hay)) return badge;
  if (a.source !== 'manual' && a.kind !== 'loan' && a.institutionName) {
    const [w1 = '', w2 = ''] = a.institutionName
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    const text = w2 ? w1.slice(0, 1) + w2.slice(0, 1) : w1.slice(0, 2);
    if (text) return { type: 'initials', text: text.toUpperCase() };
  }
  return { type: 'glyph', icon: KIND_GLYPH[a.kind] };
}
