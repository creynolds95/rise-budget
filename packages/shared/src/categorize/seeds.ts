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
