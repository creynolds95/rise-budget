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

/** Trailing words that say what the charge was, not who it was. */
const NOISE = new Set(['payment', 'pmt', 'pymt', 'autopay', 'ach', 'debit', 'purchase']);

/**
 * The bank's descriptor without its tail: "ATT PAYMENT ********" → "ATT". Strips trailing
 * reference numbers, masks and payment words, but never down to nothing.
 */
export function tidyDescriptor(raw: string): string {
  const words = raw.trim().split(/\s+/);
  while (words.length > 1) {
    const last = words[words.length - 1] as string;
    if (/^[\d#*xX.-]+$/.test(last) || NOISE.has(last.toLowerCase())) words.pop();
    else break;
  }
  return words.join(' ');
}

/**
 * The name to show for a transaction (C11, M6): the user's own display name when set, else
 * the bank's descriptor — tidied of reference numbers and payment words, and put into title
 * case if the bank shouted it.
 */
export function merchantName(t: { merchantDisplay?: string | null; merchantNormalized: string }) {
  if (t.merchantDisplay) return t.merchantDisplay;
  const n = tidyDescriptor(t.merchantNormalized);
  if (/[a-z]/.test(n)) return n;
  return n.replace(/[A-Z0-9&'.-]+/g, word);
}
