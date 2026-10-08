/**
 * Social Security and life events for the retirement plan (SPEC §12.1). Pure, integer cents,
 * today's dollars. The owner types each person's benefit at full retirement age from their
 * ssa.gov statement; Rise only applies SSA's claiming-age rules to it.
 */

/** Full retirement age for anyone born 1960 or later. */
export const FULL_RETIREMENT_AGE = 67;
export const CLAIM_AGE_MIN = 62;
export const CLAIM_AGE_MAX = 70;

/**
 * A claiming-age factor, in 3600ths. Early: 5/9 of 1% a month for the first 36 months, 5/12 of
 * 1% beyond. Late: 2/3 of 1% a month up to 70. Spousal: 25/36 of 1% a month for the first 36
 * early months, 5/12 beyond, and no credit for waiting.
 */
function factor3600(claimAge: number, spousal: boolean): number {
  const months = (claimAge - FULL_RETIREMENT_AGE) * 12;
  if (months >= 0) return spousal ? 3600 : 3600 + 24 * months;
  const early = -months;
  const first = Math.min(early, 36);
  return 3600 - (spousal ? 25 : 20) * first - 15 * (early - first);
}

/** One person's monthly check: their own benefit, or half their spouse's, whichever is more. */
export function monthlyBenefit(
  ownFraCents: number,
  spouseFraCents: number,
  claimAge: number,
  haircutPct: number,
): number {
  const own = ownFraCents * factor3600(claimAge, false);
  const spousal = Math.floor(spouseFraCents / 2) * factor3600(claimAge, true);
  return Math.round((Math.max(own, spousal) * haircutPct) / 360_000);
}

export interface Claimant {
  /** Their benefit at full retirement age, from their statement. */
  fraCents: number;
  claimAge: number;
  /** The owner's age when this person's checks start. */
  startsAtOwnerAge: number;
}

export interface SocialSecurity {
  /** Household checks a month once everyone has claimed. */
  monthlyCents: number;
  /**
   * What the portfolio must cover in the checks' place between retiring and each claim: the
   * months in between times that person's check.
   */
  bridgeCents: number;
}

/** The household's Social Security for a retirement at the owner's `retireAge`. */
export function socialSecurity(
  people: readonly Claimant[],
  retireAge: number,
  haircutPct: number,
): SocialSecurity {
  let monthlyCents = 0;
  let bridgeCents = 0;
  people.forEach((p, i) => {
    const other = people[1 - i]?.fraCents ?? 0;
    const check = monthlyBenefit(p.fraCents, other, p.claimAge, haircutPct);
    monthlyCents += check;
    bridgeCents += Math.max(0, p.startsAtOwnerAge - retireAge) * 12 * check;
  });
  return { monthlyCents, bridgeCents };
}

export interface LifeEvent {
  /** The owner's age when it happens. */
  age: number;
  /** Money in is positive (an inheritance, a house sale), money out negative (college). */
  cents: number;
}

/**
 * Life events split at retirement: before it, each lands in the projection at the end of its
 * year (`lumps[y - 1]`); at or after it, the net is what the portfolio must also cover
 * (positive = more needed).
 */
export function splitLifeEvents(
  events: readonly LifeEvent[],
  currentAge: number,
  retireAge: number,
): { lumps: number[]; afterCents: number } {
  const years = Math.max(0, retireAge - currentAge);
  const lumps: number[] = Array.from({ length: years }, () => 0);
  let afterCents = 0;
  for (const e of events) {
    if (e.age < currentAge) continue;
    if (e.age < retireAge)
      lumps[e.age - currentAge] = (lumps[e.age - currentAge] as number) + e.cents;
    else afterCents -= e.cents;
  }
  return { lumps, afterCents };
}
