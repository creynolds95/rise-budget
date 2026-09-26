import { describe, expect, it } from 'vitest';
import { merchantName } from './merchant';

const m = (merchantNormalized: string, merchantDisplay: string | null = null) =>
  merchantName({ merchantNormalized, merchantDisplay });

describe('merchantName', () => {
  it('prefers the user’s own name', () => {
    expect(m('CHIPOTLE', 'Chipotle Mexican Grill')).toBe('Chipotle Mexican Grill');
  });
  it('leaves mixed case alone', () => {
    expect(m('Amazon Marketplace')).toBe('Amazon Marketplace');
  });
  it('title-cases shouting, keeping acronyms and codes', () => {
    expect(m('CHIPOTLE')).toBe('Chipotle');
    expect(m('PAYROLL DIRECT DEPOSIT')).toBe('Payroll Direct Deposit');
    expect(m('USAA FUNDS TRANSFER DB')).toBe('USAA Funds Transfer DB');
    expect(m('OG&E UTILITY PAYMENT')).toBe('OG&E Utility Payment');
    expect(m('SHELL OIL 57442')).toBe('Shell Oil 57442');
  });
});
