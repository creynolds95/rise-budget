import {
  monthlyIncomeFor,
  neededBalanceFor,
  projectBalance,
  projectSeries,
  requiredMonthlyContribution,
  simulateRetirement,
  socialSecurity,
  splitLifeEvents,
  type Claimant,
} from '@rise/shared/retirement';
import type { RetirementPlan } from '@rise/shared/schemas';
import type { FanBand } from '../components/primitives/FanChart';

export const AGE_MIN = 55;
export const AGE_MAX = 75;

export const DEFAULT_PLAN: RetirementPlan = {
  currentAge: 30,
  goalAge: 65,
  spendTargetCents: 0,
  contributions: [],
  realGrowthBps: 400,
  withdrawalBps: 350,
  volatilityBps: 1500,
  ssBenefitCents: 0,
  ssClaimAge: 67,
  spouse: null,
  ssHaircutPct: 100,
  lifeEvents: [],
};

export interface RetirementView {
  balanceCents: number;
  /** What that balance supports per month, plus Social Security, in today's dollars. */
  incomeCents: number;
  /** Household Social Security a month once everyone has claimed. */
  ssMonthlyCents: number;
  /** Savings set aside to stand in for checks not started yet, and for later life events;
   *  negative when later money in (a house sale) more than covers them. */
  setAsideCents: number;
  /** Balance the spend target needs; null until a target is set. */
  neededCents: number | null;
  /** Projected income as a percent of the target; null until a target is set. */
  pctOfGoal: number | null;
  /**
   * Extra monthly contribution needed to reach the target by this age. Null until a target is
   * set, and null at an age with no months left to contribute in (no monthly figure gets there).
   */
  gapMonthlyCents: number | null;
  series: { age: number; balanceCents: number }[];
}

export const totalMonthly = (plan: RetirementPlan, accountIds: readonly string[]): number =>
  plan.contributions
    .filter((c) => accountIds.includes(c.accountId))
    .reduce((n, c) => n + c.monthlyCents, 0);

/** Everyone with a Social Security check, and when it starts in the owner's years. */
export function claimants(plan: RetirementPlan): Claimant[] {
  const out: Claimant[] = [];
  if (plan.ssBenefitCents > 0 || (plan.spouse?.ssBenefitCents ?? 0) > 0)
    out.push({
      fraCents: plan.ssBenefitCents,
      claimAge: plan.ssClaimAge,
      startsAtOwnerAge: plan.ssClaimAge,
    });
  if (plan.spouse && out.length > 0)
    out.push({
      fraCents: plan.spouse.ssBenefitCents,
      claimAge: plan.spouse.ssClaimAge,
      startsAtOwnerAge: plan.currentAge + plan.spouse.ssClaimAge - plan.spouse.age,
    });
  return out;
}

/**
 * The plan viewed at one retirement age, from today's retirement-account balance. Social
 * Security lowers what the portfolio must pay each month; until a check starts, and for life
 * events after retiring, the portfolio sets money aside instead (SPEC §12.1).
 */
export function retirementView(
  plan: RetirementPlan,
  startCents: number,
  monthlyCents: number,
  atAge: number,
): RetirementView {
  const years = Math.max(0, atAge - plan.currentAge);
  const { lumps, afterCents } = splitLifeEvents(plan.lifeEvents, plan.currentAge, atAge);
  const ss = socialSecurity(claimants(plan), atAge, plan.ssHaircutPct);
  const setAsideCents = ss.bridgeCents + afterCents;
  const balanceCents = projectBalance(startCents, monthlyCents, years, plan.realGrowthBps, lumps);
  const incomeCents =
    monthlyIncomeFor(Math.max(0, balanceCents - setAsideCents), plan.withdrawalBps) +
    ss.monthlyCents;
  const hasGoal = plan.spendTargetCents > 0;
  const neededCents = hasGoal
    ? Math.max(
        0,
        neededBalanceFor(Math.max(0, plan.spendTargetCents - ss.monthlyCents), plan.withdrawalBps) +
          setAsideCents,
      )
    : null;
  const required =
    neededCents === null
      ? null
      : requiredMonthlyContribution(startCents, neededCents, years, plan.realGrowthBps, lumps);
  return {
    balanceCents,
    incomeCents,
    ssMonthlyCents: ss.monthlyCents,
    setAsideCents,
    neededCents,
    pctOfGoal: hasGoal ? Math.round((incomeCents * 100) / plan.spendTargetCents) : null,
    gapMonthlyCents: required === null ? null : Math.max(0, required - monthlyCents),
    series: projectSeries(startCents, monthlyCents, years, plan.realGrowthBps, lumps).map((p) => ({
      age: plan.currentAge + p.year,
      balanceCents: p.balanceCents,
    })),
  };
}

/** The Monte Carlo fan for the plan at one retirement age. */
export function fanView(
  plan: RetirementPlan,
  startCents: number,
  monthlyCents: number,
  atAge: number,
): FanBand[] {
  const years = Math.max(0, atAge - plan.currentAge);
  const { lumps } = splitLifeEvents(plan.lifeEvents, plan.currentAge, atAge);
  const { fan } = simulateRetirement({
    lumps,
    startCents,
    monthlyContributionCents: monthlyCents,
    years,
    realGrowthBps: plan.realGrowthBps,
    volatilityBps: plan.volatilityBps,
  });
  return fan.map(({ year, ...bands }) => ({ age: plan.currentAge + year, ...bands }));
}
