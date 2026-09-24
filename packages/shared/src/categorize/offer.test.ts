import { describe, expect, it } from 'vitest';
import { declineRuleOffer, recordCategorisation, type OfferState } from './offer';

const fresh: OfferState = { suppressed: false, consecutiveSame: 0, consecutiveCategoryId: null };
const ctx = { ruleCovers: false, ambiguous: false };

function run(state: OfferState, picks: (string | null)[], c = ctx) {
  const offers: boolean[] = [];
  for (const p of picks) {
    const r = recordCategorisation(state, p, c);
    state = r.state;
    offers.push(r.offer);
  }
  return { state, offers };
}

describe('rule offer state machine (SPEC §4.6)', () => {
  it('fires after exactly 3 consecutive identical categorisations', () => {
    expect(run(fresh, ['gas', 'gas', 'gas']).offers).toEqual([false, false, true]);
  });

  it('a different category restarts the streak', () => {
    expect(run(fresh, ['gas', 'gas', 'home', 'gas', 'gas', 'gas']).offers).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('"Not now" re-arms after 3 more', () => {
    const first = run(fresh, ['gas', 'gas', 'gas']);
    expect(run(first.state, ['gas', 'gas', 'gas']).offers).toEqual([false, false, true]);
  });

  it('"No" suppresses permanently', () => {
    const declined = declineRuleOffer(run(fresh, ['gas', 'gas', 'gas']).state);
    expect(run(declined, Array(9).fill('gas')).offers.every((o) => !o)).toBe(true);
    expect(run(declined, ['gas']).state.suppressed).toBe(true);
  });

  it('never offers when a rule already covers the merchant, or for ambiguous merchants', () => {
    expect(run(fresh, ['gas', 'gas', 'gas', 'gas'], { ...ctx, ruleCovers: true }).offers).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const amazon = run(fresh, ['home', 'home', 'home'], { ...ctx, ambiguous: true });
    expect(amazon.offers).toEqual([false, false, false]);
    // The streak is held at 3, so it fires on the next pick once a rule no longer covers it.
    expect(amazon.state.consecutiveSame).toBe(3);
    expect(recordCategorisation(amazon.state, 'home', ctx).offer).toBe(true);
  });

  it('a split breaks the streak', () => {
    expect(run(fresh, ['gas', 'gas', null, 'gas']).offers).toEqual([false, false, false, false]);
    expect(run(fresh, ['gas', null]).state).toEqual(fresh);
  });
});
