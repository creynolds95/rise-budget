import {
  monthlyIncomeFor,
  simulateRetirement,
  neededBalanceFor,
  projectBalance,
  projectSeries,
  requiredMonthlyContribution,
} from '@rise/shared/retirement';
import type { RetirementPlan } from '@rise/shared/schemas';

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
  horizonAge: 95,
};

export interface RetirementView {
  balanceCents: number;
  /** What that balance supports per month, in today's dollars. */
  incomeCents: number;
  /** Balance the spend target needs; null until a target is set. */
  neededCents: number | null;
  /** Projected income as a percent of the target; null until a target is set. */
  pctOfGoal: number | null;
  /** Extra monthly contribution needed to reach the target by this age; null until a target is set. */
  gapMonthlyCents: number | null;
  series: { age: number; balanceCents: number }[];
}

export const totalMonthly = (plan: RetirementPlan, accountIds: readonly string[]): number =>
  plan.contributions
    .filter((c) => accountIds.includes(c.accountId))
    .reduce((n, c) => n + c.monthlyCents, 0);

/** The plan viewed at one retirement age, from today's retirement-account balance. */
export function retirementView(
  plan: RetirementPlan,
  startCents: number,
  monthlyCents: number,
  atAge: number,
): RetirementView {
  const years = Math.max(0, atAge - plan.currentAge);
  const balanceCents = projectBalance(startCents, monthlyCents, years, plan.realGrowthBps);
  const incomeCents = monthlyIncomeFor(balanceCents, plan.withdrawalBps);
  const hasGoal = plan.spendTargetCents > 0;
  const neededCents = hasGoal ? neededBalanceFor(plan.spendTargetCents, plan.withdrawalBps) : null;
  return {
    balanceCents,
    incomeCents,
    neededCents,
    pctOfGoal: hasGoal ? Math.round((incomeCents * 100) / plan.spendTargetCents) : null,
    gapMonthlyCents:
      neededCents === null
        ? null
        : Math.max(
            0,
            requiredMonthlyContribution(startCents, neededCents, years, plan.realGrowthBps) -
              monthlyCents,
          ),
    series: projectSeries(startCents, monthlyCents, years, plan.realGrowthBps).map((p) => ({
      age: plan.currentAge + p.year,
      balanceCents: p.balanceCents,
    })),
  };
}

export const MC_TRIALS = 1000;

/** Range of outcomes at one retirement age: fixed seed, so the fan holds still between edits. */
export function monteCarloView(
  plan: RetirementPlan,
  startCents: number,
  monthlyCents: number,
  atAge: number,
) {
  const yearsToRetire = Math.max(0, atAge - plan.currentAge);
  const res = simulateRetirement({
    startCents,
    monthlyContributionCents: monthlyCents,
    monthlySpendCents: plan.spendTargetCents,
    yearsToRetire,
    yearsToHorizon: Math.max(yearsToRetire, plan.horizonAge - plan.currentAge),
    realGrowthBps: plan.realGrowthBps,
    volatilityBps: plan.volatilityBps,
    trials: MC_TRIALS,
    seed: 1,
  });
  return {
    successPct: res.successPct,
    retireIndex: yearsToRetire,
    series: res.series.map((p) => ({ ...p, age: plan.currentAge + p.year })),
  };
}
