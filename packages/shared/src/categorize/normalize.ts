/**
 * Merchant normalisation (SPEC §4.7). Pure. The output keys merchant memory, rules and
 * recurring detection, so it must be stable for every descriptor of the same merchant.
 */

const STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY ' +
    'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'
  ).split(' '),
);

const PROCESSOR_PREFIXES = [/^SQ \*\s*/, /^TST\*\s*/, /^PAYPAL \*\s*/, /^POS DEBIT\s+/, /^SP\s+/];

const TRAILING_REFS = [/\s*\*[A-Z0-9]{4,}$/, /\s*#\d+$/];
const LONG_NUMBERS = /\b\d{6,}\b/g;

/**
 * Known merchants, matched on the cleaned descriptor's prefix. Amazon's businesses map to
 * SEPARATE merchants: Prime is a predictable subscription, Marketplace is genuinely
 * ambiguous and must never be auto-categorised with confidence.
 */
const KNOWN: [RegExp, string][] = [
  [/^AMAZON PRIME\b/, 'Amazon Prime'],
  [/^(AMZN MKTP|AMAZON MKTPL|AMAZON MARKETPLACE)\b/, 'Amazon Marketplace'],
  [/^(AMAZON DIGITAL|AMZN DIGITAL|KINDLE SVCS)\b/, 'Amazon Digital'],
  [/^(AMAZON\.COM|AMZN\.COM|AMAZON COM)\b/, 'Amazon.com'],
  [/^(AMAZON FRESH|AMZN FRESH)\b/, 'Amazon Fresh'],
  [/^WHOLEFDS\b|^WHOLE FOODS\b/, 'Whole Foods'],
  [/^APPLE\.COM\/BILL\b/, 'Apple Services'],
  [/^NETFLIX\b/, 'Netflix'],
  [/^SPOTIFY\b/, 'Spotify'],
  [/^UBER\s*\*?\s*EATS\b/, 'Uber Eats'],
  [/^UBER\b/, 'Uber'],
  [/^LYFT\b/, 'Lyft'],
  [/^DOORDASH\b/, 'DoorDash'],
  [/^WAL-?MART\b|^WM SUPERCENTER\b/, 'Walmart'],
  [/^TARGET\b/, 'Target'],
  [/^COSTCO\b/, 'Costco'],
  [/^KROGER\b/, 'Kroger'],
  [/^H-?E-?B\b/, 'H-E-B'],
  [/^QT\b|^QUIKTRIP\b/, 'QuikTrip'],
  [/^SHELL\b/, 'Shell'],
  [/^CHICK-?FIL-?A\b/, 'Chick-fil-A'],
  [/^STARBUCKS\b/, 'Starbucks'],
];

function stripTrailing(s: string): string {
  let prev: string;
  do {
    prev = s;
    for (const re of TRAILING_REFS) s = s.replace(re, '');
    // Trailing "CITY ST" when ST is a real state code — only if a merchant name remains.
    const m = /^(.*\S)\s+\S+\s+([A-Z]{2})$/.exec(s);
    if (m && STATES.has(m[2] as string)) s = m[1] as string;
    s = s.trim();
  } while (s !== prev);
  return s;
}

export function normalizeMerchant(descriptor: string): string {
  let s = descriptor.toUpperCase().replace(/\s+/g, ' ').trim();
  for (const [re, name] of KNOWN) if (re.test(s)) return name;
  for (const re of PROCESSOR_PREFIXES) s = s.replace(re, '');
  s = s.replace(LONG_NUMBERS, ' ').replace(/\s+/g, ' ').trim();
  s = stripTrailing(s);
  for (const [re, name] of KNOWN) if (re.test(s)) return name;
  return s === '' ? descriptor.toUpperCase().trim() : s;
}

/** Amazon Marketplace purchases carry no signal about what was in the box (SPEC §4.7). */
export const isAmbiguousMerchant = (merchant: string): boolean => merchant === 'Amazon Marketplace';
