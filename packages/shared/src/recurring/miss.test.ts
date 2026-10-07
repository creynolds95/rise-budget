import { describe, expect, it } from 'vitest';
import {
  continuesElsewhere,
  latestByAccount,
  merchantStem,
  missState,
  type MissInput,
} from './miss';
import type { AccountOccurrence } from './suggest';

const o = (date: string, amountCents: number, accountId = 'citi'): AccountOccurrence => ({
  date,
  amountCents,
  categoryId: null,
  accountId,
});

const espn: MissInput = {
  merchant: 'ESPN',
  cadence: 'monthly',
  nextExpectedDate: '2026-09-13',
  expectedAmountCents: 1_099,
  accountId: 'citi',
};

/** Citi kept reporting well past the due date, so a miss there is real. */
const busyCiti = new Map([['KROGER', [o('2026-09-25', 4_210)]]]);

const state = (s: MissInput, byMerchant: Map<string, AccountOccurrence[]>, today: string) =>
  missState(s, byMerchant, latestByAccount(byMerchant), today);

describe('missState', () => {
  it('is active while within a week of the due date', () => {
    expect(state(espn, busyCiti, '2026-09-20')).toBe('active');
  });

  it('is broken once a cycle is missed on a card that kept reporting', () => {
    expect(state(espn, busyCiti, '2026-09-21')).toBe('broken');
  });

  it('lapses once the next cycle is missed too', () => {
    expect(state(espn, busyCiti, '2026-10-21')).toBe('broken');
    expect(state(espn, busyCiti, '2026-10-22')).toBe('lapsed');
    expect(state({ ...espn, cadence: 'annual' }, busyCiti, '2027-09-21')).toBe('broken');
    expect(state({ ...espn, cadence: 'weekly' }, busyCiti, '2026-09-28')).toBe('lapsed');
  });

  it("stays active while the card hasn't reported past the charge's window (Apple Card)", () => {
    const apple = { ...espn, accountId: 'apple' };
    const lagging = new Map([
      ['KROGER', [o('2026-09-25', 4_210)]],
      ['UBER', [o('2026-09-16', 1_800, 'apple')]],
    ]);
    expect(state(apple, lagging, '2026-09-25')).toBe('active');
    lagging.set('LYFT', [o('2026-09-17', 1_500, 'apple')]);
    expect(state(apple, lagging, '2026-09-25')).toBe('broken');
  });

  it('stays active when the account is unknown or never reported', () => {
    expect(state({ ...espn, accountId: null }, busyCiti, '2026-09-25')).toBe('active');
    expect(state({ ...espn, accountId: 'gone' }, busyCiti, '2026-09-25')).toBe('active');
  });

  it('stays active when the charge landed under a drifted name', () => {
    const drift = new Map([...busyCiti, ['ESPN PLUS', [o('2026-09-14', 1_099, 'apple')]]]);
    expect(state(espn, drift, '2026-09-25')).toBe('active');
  });
});

describe('continuesElsewhere', () => {
  const at = (merchant: string, date: string, cents: number) =>
    continuesElsewhere(espn, new Map([[merchant, [o(date, cents)]]]));

  it('needs the same stem, a steady amount, the same sign, and the due week', () => {
    expect(at('ESPN PLUS', '2026-09-17', 1_099)).toBe(true);
    expect(at('ESPN PLUS', '2026-09-18', 1_099)).toBe(false);
    expect(at('ESPN PLUS', '2026-09-13', 1_500)).toBe(false);
    expect(at('ESPN PLUS', '2026-09-13', -1_099)).toBe(false);
    expect(at('HULU', '2026-09-13', 1_099)).toBe(false);
    expect(at('ESPN', '2026-09-13', 1_099)).toBe(false); // itself
  });

  it('a steady amount is within 5% of the expected one, not ~10%', () => {
    expect(at('ESPN PLUS', '2026-09-13', 1_153)).toBe(true); // +4.9%
    expect(at('ESPN PLUS', '2026-09-13', 1_198)).toBe(false); // +9.0%
  });

  it('never matches a name with no distinctive word', () => {
    const plain = { ...espn, merchant: 'ACH PAYMENT' };
    expect(continuesElsewhere(plain, new Map([['ACH WEB', [o('2026-09-13', 1_099)]]]))).toBe(false);
  });
});

describe('merchantStem', () => {
  it('takes the first distinctive word', () => {
    expect(merchantStem('Abc*')).toBe('ABC');
    expect(merchantStem('The Otf N Dallas')).toBe('OTF');
    expect(merchantStem('ACH WEB 12')).toBeNull();
    expect(merchantStem('12')).toBeNull();
  });
});

describe('latestByAccount', () => {
  it('keeps the latest date per account', () => {
    const m = new Map([
      ['A', [o('2026-09-01', 1), o('2026-09-03', 1, 'apple')]],
      ['B', [o('2026-08-01', 1), o('2026-09-02', 1, 'apple')]],
    ]);
    expect([...latestByAccount(m)]).toEqual([
      ['citi', '2026-09-01'],
      ['apple', '2026-09-03'],
    ]);
  });
});
