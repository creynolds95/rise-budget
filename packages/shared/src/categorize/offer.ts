/**
 * Rule offers (SPEC §4.6). Pure. A rule is permanent and overrides everything, so it is
 * offered, never created: after exactly 3 consecutive identical manual categorisations of a
 * merchant that no rule already covers.
 *
 * - Offering resets the streak, so "Not now" needs no call and re-arms after 3 more.
 * - "No" suppresses offers for the merchant permanently (`declineRuleOffer`).
 * - A split is not an identical categorisation, so it breaks the streak.
 * - Ambiguous merchants (Amazon Marketplace) are never offered a rule: one category for
 *   every box would be a guess about what was in it.
 */

export interface OfferState {
  suppressed: boolean;
  consecutiveSame: number;
  consecutiveCategoryId: string | null;
}

export const OFFER_AFTER = 3;

export function recordCategorisation(
  state: OfferState,
  /** The single category chosen, or null for a split. */
  categoryId: string | null,
  ctx: { ruleCovers: boolean; ambiguous: boolean },
): { state: OfferState; offer: boolean } {
  if (categoryId === null) {
    return { state: { ...state, consecutiveSame: 0, consecutiveCategoryId: null }, offer: false };
  }
  const count =
    categoryId === state.consecutiveCategoryId
      ? Math.min(state.consecutiveSame + 1, OFFER_AFTER)
      : 1;
  const offer = count >= OFFER_AFTER && !state.suppressed && !ctx.ruleCovers && !ctx.ambiguous;
  return {
    state: {
      suppressed: state.suppressed,
      consecutiveSame: offer ? 0 : count,
      consecutiveCategoryId: offer ? null : categoryId,
    },
    offer,
  };
}

export const declineRuleOffer = (state: OfferState): OfferState => ({ ...state, suppressed: true });
