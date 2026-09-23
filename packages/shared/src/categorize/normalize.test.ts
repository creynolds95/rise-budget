import { describe, expect, it } from 'vitest';
import { isAmbiguousMerchant, normalizeMerchant } from './normalize';

// T24: ~40 real-shaped descriptors. Synthetic but in the formats banks actually emit.
const FIXTURES: [string, string][] = [
  ['Amazon Prime*2K4LM9PQ1', 'Amazon Prime'],
  ['AMAZON PRIME*RT5YU8', 'Amazon Prime'],
  ['AMZN Mktp US*2K1AB3CD4', 'Amazon Marketplace'],
  ['AMZN MKTP US*HX83K0QJ2 AMZN.COM/BILLWA', 'Amazon Marketplace'],
  ['Amazon.com*MK2LP44R0', 'Amazon.com'],
  ['AMAZON.COM*TQ9WE11 AMZN.COM/BILL WA', 'Amazon.com'],
  ['Amazon Digital Svcs*8JK1', 'Amazon Digital'],
  ['Kindle Svcs*ZX12AB', 'Amazon Digital'],
  ['WHOLEFDS DAL 10234', 'Whole Foods'],
  ['APPLE.COM/BILL 866-712-7753 CA', 'Apple Services'],
  ['NETFLIX.COM LOS GATOS CA', 'Netflix'],
  ['Spotify USA 877-778-1161 NY', 'Spotify'],
  ['UBER *EATS PENDING', 'Uber Eats'],
  ['UBER   *TRIP HELP.UBER.COM', 'Uber'],
  ['LYFT *RIDE SAT 8PM', 'Lyft'],
  ['DOORDASH*CHIPOTLE', 'DoorDash'],
  ['WAL-MART #5260 DALLAS TX', 'Walmart'],
  ['WM SUPERCENTER #1234', 'Walmart'],
  ['TARGET        00012345 PLANO TX', 'Target'],
  ['COSTCO WHSE #0681 FRISCO TX', 'Costco'],
  ['KROGER #512 ALLEN TX', 'Kroger'],
  ['H-E-B #577 AUSTIN TX', 'H-E-B'],
  ['QT 894 OUTSIDE PLANO TX', 'QuikTrip'],
  ['QUIKTRIP #0894', 'QuikTrip'],
  ['SHELL OIL 57444632100 DALLAS TX', 'Shell'],
  ['CHICK-FIL-A #01234 RICHARDSON TX', 'Chick-fil-A'],
  ['STARBUCKS STORE 12345 DALLAS TX', 'Starbucks'],
  ['SQ *BLUE BOTTLE COFFEE', 'BLUE BOTTLE COFFEE'],
  ['SQ *BLUE BOTTLE COFFEE Dallas TX', 'BLUE BOTTLE COFFEE'],
  ['TST* PECAN LODGE - DEEP', 'PECAN LODGE - DEEP'],
  ['TST*PECAN LODGE - DEEP DALLAS TX', 'PECAN LODGE - DEEP'],
  ['PAYPAL *STEAMGAMES 4029357733', 'STEAMGAMES'],
  ['POS DEBIT CORNER BAKERY #172', 'CORNER BAKERY'],
  ['SP ALLBIRDS', 'ALLBIRDS'],
  ['USAA P&C INT AUTOPAY 123456789', 'USAA P&C INT AUTOPAY'],
  ['ATT*BILL PAYMENT 800-331-0500 TX', 'ATT*BILL PAYMENT'],
  ['CITY OF DALLAS WATER #4411', 'CITY OF DALLAS WATER'],
  ['TXU ENERGY 8008186132 TX', 'TXU'],
  ['PLANET FITNESS 00123456', 'PLANET FITNESS'],
  ['CHEVRON 0206543', 'CHEVRON'],
  ['  multiple   spaces   here  ', 'MULTIPLE SPACES HERE'],
  ['SQ *STARBUCKS RESERVE', 'Starbucks'],
  ['PAYPAL *NETFLIX', 'Netflix'],
];

describe('normalizeMerchant', () => {
  it.each(FIXTURES)('%s → %s', (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it('Amazon Prime and Marketplace normalise to DIFFERENT merchants', () => {
    expect(normalizeMerchant('Amazon Prime*2K4LM9PQ1')).not.toBe(
      normalizeMerchant('AMZN Mktp US*2K1AB3CD4'),
    );
  });

  it('is stable across store numbers and cities', () => {
    expect(normalizeMerchant('SQ *BLUE BOTTLE COFFEE Dallas TX')).toBe(
      normalizeMerchant('SQ *BLUE BOTTLE COFFEE'),
    );
  });

  it('never returns empty', () => {
    expect(normalizeMerchant('#12345')).toBe('#12345');
  });

  it('flags only marketplace as ambiguous', () => {
    expect(isAmbiguousMerchant('Amazon Marketplace')).toBe(true);
    expect(isAmbiguousMerchant('Amazon Prime')).toBe(false);
  });
});
