import { detectSemimonthly, detectSeries, type DetectedSeries, type Occurrence } from './detect';

export interface AccountOccurrence extends Occurrence {
  accountId: string;
}

export interface SurplusSuggestion {
  merchant: string;
  /** The account its latest occurrence posted to. */
  accountId: string;
  series: DetectedSeries;
}

/**
 * Schedules Surplus asks the user to confirm: an active series found in the cash accounts'
 * own transactions, for a merchant not already in Surplus or dismissed from it. Nothing here
 * is ever projected until the user adds it.
 */
export function surplusSuggestions(
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
  cashAccountIds: ReadonlySet<string>,
  skip: ReadonlySet<string>,
  today: string,
): SurplusSuggestion[] {
  const out: SurplusSuggestion[] = [];
  for (const [merchant, all] of byMerchant) {
    if (skip.has(merchant)) continue;
    const occ = [...all]
      .filter((o) => cashAccountIds.has(o.accountId))
      .sort((a, b) => a.date.localeCompare(b.date));
    // Semimonthly first, same as refreshRecurring.
    const series = detectSemimonthly(occ, today) ?? detectSeries(occ, today);
    if (series?.status !== 'active') continue;
    const accountId = occ.reduce((_, o) => o.accountId, '');
    out.push({ merchant, accountId, series });
  }
  return out;
}
