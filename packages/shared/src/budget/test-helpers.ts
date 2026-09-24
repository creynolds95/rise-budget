import type { CloseCategory, PeriodCloseInput } from './close';
import type { SlackInput } from './reallocation';

export function cat(o: Partial<CloseCategory> & { categoryId: string }): CloseCategory {
  return { rolloverPolicy: 'roll', carriedInCents: 0, plannedCents: 0, spentCents: 0, ...o };
}

export function period(o: Partial<PeriodCloseInput> & { periodId: string }): PeriodCloseInput {
  return {
    status: 'open',
    expectedIncomeCents: 0,
    actualIncomeCents: 0,
    rollIncomeVariance: false,
    categories: [],
    ...o,
  };
}

export function slackCat(o: Partial<SlackInput> & { categoryId: string }): SlackInput {
  return {
    spendShape: 'linear',
    carriedInCents: 0,
    plannedCents: 0,
    spentCents: 0,
    billPosted: false,
    ...o,
  };
}
