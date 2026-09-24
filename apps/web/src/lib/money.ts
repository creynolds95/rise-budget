/**
 * Money on screen. Integer cents in, strings out — no float ever touches an amount.
 * The minus sign is U+2212 so it has the same width as the plus sign in tabular figures.
 */
export const MINUS = '−';

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface FormatOptions {
  /** Drop the cents, rounding half away from zero. */
  whole?: boolean;
  /** 'auto' shows only minus; 'always' shows + too; 'never' shows neither. */
  sign?: 'auto' | 'always' | 'never';
}

export function formatCents(cents: number, opts: FormatOptions = {}): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError(`Not integer cents: ${cents}`);
  const abs = Math.abs(cents);
  const body = opts.whole
    ? `$${group(String(Math.floor((abs + 50) / 100)))}`
    : `$${group(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}`;
  const zero = opts.whole ? Math.floor((abs + 50) / 100) === 0 : abs === 0;
  const sign = opts.sign ?? 'auto';
  if (zero || sign === 'never') return body;
  if (cents < 0) return `${MINUS}${body}`;
  return sign === 'always' ? `+${body}` : body;
}

/**
 * What a person typed → cents, or null if it isn't an amount. Accepts "$1,234.5", "12",
 * ".5", "-3.20", and a leading U+2212. More than two decimals is rejected, not rounded.
 */
export function parseMoney(input: string): number | null {
  const s = input
    .trim()
    .replace(/^\$/, '')
    .replace(MINUS, '-')
    .replace(/[,\s$]/g, '');
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const cents = Number(m[2] || '0') * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] && cents !== 0 ? -cents : cents;
}

/** Cents as the plain editable string a field starts with: 25000 → "250.00". */
export const centsToInput = (cents: number) =>
  formatCents(cents).replace(/[$,]/g, '').replace(MINUS, '-');
