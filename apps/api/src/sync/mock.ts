import type { SimpleFinSource } from './source';

/**
 * A stand-in SimpleFIN bridge for Caleb's seven accounts, for building and testing before
 * the real connection is paid for. Deterministic: the same `now` always returns the same
 * data, so repeated syncs behave like the real thing. Speaks the wire format (decimal
 * strings, money out negative), so everything downstream runs unchanged.
 *
 * Realism it models: card payments from checking (transfers), a savings transfer, pending
 * rows that post two days later under a new id with a small amount drift, and Apple
 * accounts that only report once a month.
 */

const DAY = 86_400;
const EPOCH_DAY = Date.UTC(2026, 6, 1) / 1000 / DAY; // balances accumulate from 2026-07-01

type AccountKey =
  'checking' | 'savings' | 'usaaCredit' | 'chase' | 'citi' | 'appleCard' | 'appleSavings';

const ACCOUNTS: Record<
  AccountKey,
  { id: string; org: string; name: string; base: number; monthly?: true }
> = {
  checking: { id: 'mock-usaa-checking', org: 'USAA', name: 'USAA Checking', base: 320_000 },
  savings: { id: 'mock-usaa-savings', org: 'USAA', name: 'USAA Savings', base: 800_000 },
  usaaCredit: { id: 'mock-usaa-credit', org: 'USAA', name: 'USAA Credit', base: -41_250 },
  chase: { id: 'mock-chase-credit', org: 'Chase', name: 'Chase Credit', base: -58_310 },
  citi: { id: 'mock-citi-credit', org: 'Citi', name: 'Citi Credit', base: -23_975 },
  appleCard: {
    id: 'mock-apple-card',
    org: 'Apple',
    name: 'Apple Card',
    base: -18_840,
    monthly: true,
  },
  appleSavings: {
    id: 'mock-apple-savings',
    org: 'Apple',
    name: 'Apple Savings',
    base: 1_250_000,
    monthly: true,
  },
};

interface Event {
  account: AccountKey;
  key: string;
  /** SimpleFIN sign: money out negative. */
  cents: number;
  description: string;
}

/** FNV-1a, for stable pseudo-random choices keyed on the date. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
/** Integer cents → the wire's decimal string, without passing through a float. */
export function centsToDecimal(c: number): string {
  const abs = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const between = (h: number, min: number, max: number) => min + (h % (max - min + 1));
const pick = <T>(h: number, xs: readonly T[]): T => xs[h % xs.length] as T;

function eventsOn(day: number): Event[] {
  const date = new Date(day * DAY * 1000);
  const dom = date.getUTCDate();
  const tag = date.toISOString().slice(0, 10);
  const h = (salt: string) => hash(`${tag}:${salt}`);
  const out: Event[] = [];
  const add = (account: AccountKey, salt: string, cents: number, description: string) =>
    out.push({ account, key: `${tag}-${salt}`, cents, description });
  const payment = (card: AccountKey, salt: string, outDesc: string, inDesc: string) => {
    const amount = between(h(salt), 20_000, 90_000);
    add('checking', `${salt}-out`, -amount, outDesc);
    add(card, `${salt}-in`, amount, inDesc);
  };

  if ((day - EPOCH_DAY) % 14 === 3) add('checking', 'pay', 245_000, 'PAYROLL DIRECT DEPOSIT');
  if (dom === 1) {
    add('checking', 'rent', -165_000, 'RENT PAYMENT ONLINE');
    add('appleSavings', 'interest', between(h('int'), 3_800, 4_400), 'Interest Paid');
  }
  if (dom === 3)
    payment(
      'chase',
      'chase-pay',
      'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
      'AUTOMATIC PAYMENT - THANK YOU',
    );
  if (dom === 8)
    payment(
      'citi',
      'citi-pay',
      'CITI AUTOPAY PAYMENT 250719',
      'AUTOPAY 000000000065982RAUTOPAY AUTO-PMT',
    );
  if (dom === 12)
    payment(
      'usaaCredit',
      'usaa-pay',
      'USAA CREDIT CARD PAYMENT',
      'USAA CREDIT CARD PAYMENT RECEIVED',
    );
  if (dom === 15) {
    add('checking', 'save-out', -20_000, 'USAA FUNDS TRANSFER DB');
    add('savings', 'save-in', 20_000, 'USAA FUNDS TRANSFER CR');
  }
  if (dom === 20)
    payment(
      'appleCard',
      'apple-pay',
      'APPLECARD GSBANK PAYMENT 1234567',
      'ACH Deposit Internet transfer from account ending in 4411',
    );
  if (dom === 5) add('appleCard', 'icloud', -299, 'APPLE.COM/BILL 866-712-7753 CA');
  if (dom === 7) add('chase', 'netflix', -1_549, 'NETFLIX.COM LOS GATOS CA');
  if (dom === 11) add('citi', 'spotify', -1_199, 'SPOTIFY USA 877-7781161 NY');
  if (dom === 18) add('usaaCredit', 'prime', -1_499, 'Amazon Prime*2K4LM81Q3');
  if (dom === 22)
    add('checking', 'power', -between(h('power'), 9_000, 16_000), 'OG&E UTILITY PAYMENT');

  if (h('groc') % 3 === 0)
    add(
      'chase',
      'groc',
      -between(h('groc-amt'), 2_500, 16_000),
      pick(h('groc-m'), [
        'KROGER #512 TULSA OK',
        'ALDI 72031 BROKEN ARROW OK',
        'WHOLEFDS TUL 10423',
      ]),
    );
  if (h('gas') % 5 === 0)
    add(
      'usaaCredit',
      'gas',
      -between(h('gas-amt'), 3_000, 6_500),
      pick(h('gas-m'), ['QT 0412 OUTSIDE TULSA OK', 'SHELL OIL 57444412 TULSA OK']),
    );
  if (h('eat') % 2 === 0)
    add(
      'citi',
      'eat',
      -between(h('eat-amt'), 800, 4_500),
      pick(h('eat-m'), [
        'CHICK-FIL-A #01234 TULSA OK',
        'STARBUCKS STORE 12345',
        'SQ *CHIPOTLE 2231 TULSA OK',
        'TST* ANDOLINI S PIZZERIA',
      ]),
    );
  if (h('amzn') % 4 === 0)
    add(
      'citi',
      'amzn',
      -between(h('amzn-amt'), 1_200, 9_000),
      `AMZN Mktp US*${(h('amzn-id') % 1e8).toString(36).toUpperCase().padStart(6, '0')}`,
    );
  if (h('uber') % 9 === 0)
    add(
      'appleCard',
      'uber',
      -between(h('uber-amt'), 1_800, 4_200),
      'UBER *EATS PENDING HELP.UBER.COM',
    );
  return out;
}

export function mockAccountSet(nowSec: number, startDate: number) {
  const today = Math.floor(nowSec / DAY);
  // Apple reports once a month: everything up to the 1st, dated the 1st.
  const d = new Date(today * DAY * 1000);
  const appleDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 / DAY;

  const balances = new Map<AccountKey, number>();
  const txns = new Map<AccountKey, unknown[]>();
  for (let day = EPOCH_DAY; day <= today; day++) {
    for (const e of eventsOn(day)) {
      const account = ACCOUNTS[e.account];
      const reportedUntil = account.monthly ? appleDay - 1 : today;
      if (day > reportedUntil) continue;
      balances.set(e.account, (balances.get(e.account) ?? 0) + e.cents);
      const posted = day * DAY + 18 * 3600;
      if (posted < startDate) continue;
      // The last two days are still pending, under their own id and a few cents off.
      const pending = !account.monthly && today - day < 2;
      const cents = pending ? e.cents - (e.cents < 0 ? 37 : 0) : e.cents;
      txns.set(e.account, [
        ...(txns.get(e.account) ?? []),
        {
          id: pending ? `${e.key}-pending` : e.key,
          posted: pending ? 0 : posted,
          transacted_at: posted,
          amount: centsToDecimal(cents),
          description: e.description,
          ...(pending ? { pending: true } : {}),
        },
      ]);
    }
  }

  return {
    errors: [],
    accounts: (Object.keys(ACCOUNTS) as AccountKey[]).map((k) => {
      const a = ACCOUNTS[k];
      const reported = a.monthly ? appleDay : today;
      return {
        org: {
          name: a.org,
          domain: `${a.org.toLowerCase()}.com`,
          'sfin-url': 'https://mock.simplefin.invalid',
        },
        id: a.id,
        name: a.name,
        currency: 'USD',
        balance: centsToDecimal(a.base + (balances.get(k) ?? 0)),
        'balance-date': reported * DAY + 12 * 3600,
        transactions: txns.get(k) ?? [],
      };
    }),
  };
}

export function mockSimpleFin(now: () => Date): SimpleFinSource {
  return {
    mode: 'mock',
    fetchAccounts: (startDate) =>
      Promise.resolve(mockAccountSet(Math.floor(now().getTime() / 1000), startDate)),
  };
}
