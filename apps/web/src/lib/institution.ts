import type { AccountBadgeStyle, AccountKind } from '@rise/shared/schemas';
import type { BrandMark } from './brandMarks';

/** What sits in the round badge left of an account's name. */
export type AccountBadge =
  | { type: 'brand'; mark: BrandMark }
  | { type: 'word'; text: string; color: string }
  | { type: 'drawn'; mark: 'guidestone' | 'mohela' | 'empower' }
  | { type: 'initials'; text: string }
  | { type: 'custom'; text: string; bg: string; fg: string }
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
  [/\bguidestone\b/, { type: 'drawn', mark: 'guidestone' }],
  [/\bempower\b/, { type: 'drawn', mark: 'empower' }],
  // Student loans: federal ones, and the Texas Higher Education Coordinating Board's
  // (synced under its full name, or kept by hand as "CL0001"-style accounts).
  [/\b(fed|federal) loan\b|\bmohela\b/, { type: 'drawn', mark: 'mohela' }],
  [/\btexas higher education\b|^cl\d{4}\b/, { type: 'word', text: 'THECB', color: '#7A1F2B' }],
];

const KIND_GLYPH: Record<AccountKind, Extract<AccountBadge, { type: 'glyph' }>['icon']> = {
  depository: 'bank',
  credit: 'card',
  loan: 'doc',
  investment: 'wallet',
  other: 'home',
};

interface BadgeInput {
  name: string;
  kind: AccountKind;
  source: string;
  institutionName: string | null;
  badge?: AccountBadgeStyle | null;
}

/** The bank's own mark, when Rise has one; null for an institution it doesn't recognize. */
function knownMark(a: BadgeInput): AccountBadge | null {
  // Synced accounts are matched on their bank; manual ones on whatever the user named them.
  const hay = (a.institutionName ?? (a.source === 'manual' ? a.name : '')).toLowerCase();
  for (const [re, badge] of BRANDS) if (re.test(hay)) return badge;
  return null;
}

/** Only unrecognized institutions get a badge the user designs; a known logo always wins. */
export const canCustomizeBadge = (a: BadgeInput) => knownMark(a) === null;

export function accountBadge(a: BadgeInput): AccountBadge {
  const known = knownMark(a);
  if (known) return known;
  if (a.badge) return { type: 'custom', ...a.badge };
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

/** Choices offered in the badge editor; a color picker covers anything else. */
export const BADGE_BACKGROUNDS = [
  '#1b2d5b',
  '#056dae',
  '#0f766e',
  '#2f6b3a',
  '#7a1f2b',
  '#c8102e',
  '#d97706',
  '#6d28d9',
  '#374151',
  '#ffffff',
] as const;
export const BADGE_TEXT_COLORS = ['#ffffff', '#111111', '#1b2d5b', '#c8102e'] as const;

/** Where the editor starts: the automatic initials, white on navy. */
export const defaultBadge = (initials: string | null): AccountBadgeStyle => ({
  text: initials ?? '',
  bg: BADGE_BACKGROUNDS[0],
  fg: BADGE_TEXT_COLORS[0],
});
