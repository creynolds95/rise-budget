type Cents = number;

/**
 * Equity is the home's value less what is still owed. Loan balances are stored negative
 * (a liability), so owing $200,000 is -20_000_000; a balance reported above zero would be a
 * credit with the lender and never adds to equity.
 */
export function equityCents(valueCents: Cents, mortgageBalanceCents: Cents): Cents {
  return valueCents - Math.max(0, -mortgageBalanceCents);
}
