/** Kept as written: bank and brand names that read wrong in title case. */
const ACRONYMS = new Set([
  'USAA',
  'ATM',
  'ACH',
  'LLC',
  'CVS',
  'QT',
  'IRS',
  'HEB',
  'KFC',
  'BP',
  'ID',
  'US',
  'USA',
  'TX',
  'OK',
]);

function word(w: string): string {
  if (ACRONYMS.has(w) || /[&\d]/.test(w) || !/[AEIOUY]/.test(w)) return w;
  return w.charAt(0) + w.slice(1).toLowerCase();
}

/**
 * The name to show for a transaction (C11, M6): the user's own display name when set, else
 * the bank's descriptor — shouted in capitals by most banks — put into title case.
 */
export function merchantName(t: { merchantDisplay?: string | null; merchantNormalized: string }) {
  if (t.merchantDisplay) return t.merchantDisplay;
  const n = t.merchantNormalized;
  if (/[a-z]/.test(n)) return n;
  return n.replace(/[A-Z0-9&'.-]+/g, word);
}
