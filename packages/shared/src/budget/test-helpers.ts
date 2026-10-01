import type { SlackInput } from './reallocation';
import type { ChainCategory, ChainMonth, MonthCategory } from './rollover';

export function cat(o: Partial<MonthCategory> & { categoryId: string }): MonthCategory {
  return { rolloverPolicy: 'roll', carriedInCents: 0, plannedCents: 0, spentCents: 0, ...o };
}

export function chainCat(o: Partial<ChainCategory> & { categoryId: string }): ChainCategory {
  return { rolloverPolicy: 'roll', plannedCents: 0, spentCents: 0, adjustCents: 0, ...o };
}

export function month(o: Partial<ChainMonth> & { periodId: string }): ChainMonth {
  return { categories: [], ...o };
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
