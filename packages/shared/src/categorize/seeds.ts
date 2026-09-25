/**
 * SPEC §4.4 keyword seeds, so month one isn't blank. Rise ships no categories, so a seed
 * names the categories it would fit and resolves against the user's own, by name. Seeds sit
 * at 0.5 confidence: below the pre-fill line, so a seed is offered as a one-tap button. The first
 * manual choice for a merchant puts it in memory, which outranks seeds from then on.
 */
const SEEDS: [RegExp, string[]][] = [
  [
    /\b(SHELL|CHEVRON|EXXON|EXXONMOBIL|MOBIL|QUIKTRIP|QT|BP|VALERO|PHILLIPS 66|CONOCO|SUNOCO|MARATHON|CIRCLE K|RACETRAC|WAWA|SHEETZ|CASEYS|LOVE'?S|PILOT|MURPHY USA|MAVERIK|SPEEDWAY|GAS|FUEL)\b/,
    ['Gas', 'Fuel', 'Gas & fuel', 'Auto'],
  ],
  [
    /\b(KROGER|ALDI|H-E-B|HEB|PUBLIX|SAFEWAY|TRADER JOE'?S|WHOLE FOODS|SPROUTS|WINCO|FOOD LION|MEIJER|HY-VEE|WEGMANS|ALBERTSONS|INSTACART|AMAZON FRESH|GROCERY|MARKET)\b/i,
    ['Groceries', 'Grocery', 'Food'],
  ],
  [
    /\b(STARBUCKS|MCDONALD'?S|CHICK-FIL-A|CHIPOTLE|TACO BELL|WENDY'?S|BURGER KING|SUBWAY|DOMINO'?S|PIZZA HUT|PANERA|SONIC|DUNKIN|WHATABURGER|RAISING CANE'?S|DOORDASH|UBER EATS|GRUBHUB|RESTAURANT|CAFE|COFFEE|GRILL|PIZZA)\b/i,
    ['Eating out', 'Dining', 'Restaurants', 'Dining out', 'Food'],
  ],
  [
    /\b(NETFLIX|SPOTIFY|HULU|DISNEY PLUS|DISNEYPLUS|HBO MAX|YOUTUBE PREMIUM|PARAMOUNT|PEACOCK|AMAZON PRIME|APPLE SERVICES)\b/i,
    ['Subscriptions', 'Streaming', 'Entertainment'],
  ],
  [/\b(UBER|LYFT|PARKING|TOLL|TOLLWAY)\b/i, ['Transportation', 'Transport', 'Rideshare', 'Auto']],
  [/\b(CVS|WALGREENS|RITE AID|PHARMACY)\b/i, ['Health', 'Pharmacy', 'Medical']],
  [
    /\b(RENT|APARTMENTS?|PROPERTY MGMT|PROPERTY MANAGEMENT|MORTGAGE|LOAN SERVICING|MR\. ?COOPER|ROCKET MORTGAGE|WELLS FARGO HOME|QUICKEN LOANS)\b/i,
    ['Rent/Mortgage', 'Home'],
  ],
  [
    /\b(ELECTRIC|UTILITY|UTILITIES|WATER|GAS COMPANY|OG&E|OGE ENERGY|CENTERPOINT|ATMOS ENERGY|POWER CO|POWER COMPANY|SEWER|TRASH|WASTE MANAGEMENT|COX COMM|SPECTRUM|XFINITY|COMCAST|AT&T|ATT\b|VERIZON|T-MOBILE)\b/i,
    ['Utilities', 'Home'],
  ],
  [
    /\b(INSURANCE|GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|USAA INSURANCE|LIBERTY MUTUAL|FARMERS INSURANCE)\b/i,
    ['Car Insurance', 'Health Insurance', 'Insurance'],
  ],
  [
    /\b(PAYROLL|DIRECT DEP|DIRECT DEPOSIT|DIR DEP|PAYCHECK|SALARY|ADP\b|GUSTO PAY)\b/i,
    ['Paycheck', 'Income', 'Other Income'],
  ],
  [/\b(AUTO LOAN|CAR LOAN)\b/i, ['Car Payment', 'Loans', 'Auto']],
  [
    /\b(STUDENT LOAN|SALLIE MAE|NAVIENT|NELNET|GREAT LAKES LOAN)\b/i,
    ['Loans', 'Debt Payoff', 'Personal'],
  ],
  [
    /\b(CREDIT CARD PAYMENT|CARD PAYMENT|GSBANK PAYMENT|APPLECARD.*PAYMENT|CHASE CARD.*PAYMENT|CAPITAL ONE.*PAYMENT|DISCOVER.*PAYMENT|AMEX.*PAYMENT|SYNCHRONY.*PAYMENT|BARCLAYCARD.*PAYMENT)\b/i,
    ['Credit Card Payment', 'Transfer'],
  ],
];

export function resolveSeed(
  merchant: string,
  categories: readonly { id: string; name: string }[],
): string | null {
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const m = merchant.toUpperCase();
  for (const [re, names] of SEEDS) {
    if (!re.test(m)) continue;
    for (const name of names) {
      const id = byName.get(name.toLowerCase());
      if (id) return id;
    }
  }
  return null;
}
