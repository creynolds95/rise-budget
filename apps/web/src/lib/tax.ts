import type { TaxKind } from '@rise/shared/schemas';

/** What each tax heading is called on screen and in the CSV, in picker order. */
export const TAX_KINDS: { kind: TaxKind; label: string }[] = [
  { kind: 'income_1099', label: '1099 income' },
  { kind: 'income_other', label: 'Other taxable income' },
  { kind: 'charity', label: 'Charitable giving' },
  { kind: 'medical', label: 'Medical' },
  { kind: 'dependent_care', label: 'Dependent care' },
  { kind: 'education', label: 'Education' },
  { kind: 'mortgage_interest', label: 'Mortgage interest' },
  { kind: 'property_tax', label: 'Property tax' },
  { kind: 'business_expense', label: 'Business expense' },
];

export const taxLabel = (k: TaxKind): string => TAX_KINDS.find((t) => t.kind === k)?.label ?? k;

export { INCOME_TAX_KINDS as INCOME_KINDS } from '@rise/shared/reports';

/** Through April, the year people are filing for is last year. */
export const defaultTaxYear = (today: string): number =>
  Number(today.slice(5, 7)) <= 4 ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4));
