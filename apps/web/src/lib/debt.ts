import {
  isDue,
  monthlyInterest,
  simulatePayoff,
  stepBalance,
  type Lump,
  type Strategy,
} from '@rise/shared/debt';
import type { Account, DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import { addMonths, monthName, monthsBetween } from './dates';

export const DEFAULT_DEBT_PLAN: DebtPlan = {
  loans: [],
  autoApply: true,
  lastAuto: null,
  strategy: 'snowball',
  rollForward: true,
  extraCents: 0,
  mortgageExtraCents: 0,
  mortgageLumps: [],
  mortgageTermMonths: 360,
  homeValueAccountId: null,
};

/** Liability balances are stored negative; the plan works in what is owed. */
export const owedCents = (balanceCents: number): number => Math.max(0, -balanceCents);

/** 5.875 on screen, 5875 stored. */
export const aprToText = (milli: number): string => String(milli / 1000);
export const aprFromText = (text: string): number | null => {
  const n = Number(text.replace('%', '').trim());
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100
    ? Math.round(n * 1000)
    : null;
};

export interface LoanRow {
  plan: DebtLoanPlan;
  name: string;
  owedCents: number;
  /** "2031-04" when the loan finishes; null if it never does at this payment. */
  payoffPeriod: string | null;
  done: boolean;
  /** This month's interest; a payment at or under it never pays the loan off. */
  interestCents: number;
}

export interface GroupView {
  rows: LoanRow[];
  owedCents: number;
  debtFreePeriod: string | null;
  interestCents: number;
  /** Against the same plan with no extra; null when there is no extra or no baseline date. */
  monthsSooner: number | null;
  interestSavedCents: number | null;
  totalOwedByMonth: number[];
}

/** One group of loans, one payoff plan. Months count from next month, so dates err late. */
export function groupView(
  loans: { plan: DebtLoanPlan; name: string; owedCents: number }[],
  opts: { extraCents: number; strategy: Strategy; rollForward: boolean },
  period: string,
): GroupView {
  const run = (extraCents: number) =>
    simulatePayoff(
      loans.map((l) => ({
        id: l.plan.accountId,
        balanceCents: l.owedCents,
        aprMilliPct: l.plan.aprMilliPct,
        paymentCents: l.plan.paymentCents,
      })),
      { ...opts, extraCents },
    );
  const result = run(opts.extraCents);
  const base = opts.extraCents > 0 ? run(0) : null;
  const sooner =
    base !== null && base.debtFreeMonth !== null && result.debtFreeMonth !== null
      ? base.debtFreeMonth - result.debtFreeMonth
      : null;
  return {
    rows: loans.map((l, i) => {
      const month = result.loans[i]?.payoffMonth ?? null;
      return {
        plan: l.plan,
        name: l.name,
        owedCents: l.owedCents,
        payoffPeriod: month === null ? null : addMonths(period, month),
        done: l.owedCents === 0,
        interestCents: monthlyInterest(l.owedCents, l.plan.aprMilliPct),
      };
    }),
    owedCents: loans.reduce((n, l) => n + l.owedCents, 0),
    debtFreePeriod: result.debtFreeMonth === null ? null : addMonths(period, result.debtFreeMonth),
    interestCents: result.totalInterestCents,
    monthsSooner: sooner,
    interestSavedCents:
      base !== null && sooner !== null ? base.totalInterestCents - result.totalInterestCents : null,
    totalOwedByMonth: result.totalOwedByMonth,
  };
}

export interface PaymentSuggestion {
  plan: DebtLoanPlan;
  name: string;
  beforeCents: number;
  afterCents: number;
}

/**
 * Loans whose payment for this month is due and not yet in the balance. Manual accounts only:
 * a synced balance already comes from the bank. Nothing is applied until the user says so.
 */
export function dueSuggestions(
  plan: DebtPlan,
  accounts: Pick<Account, 'id' | 'name' | 'source' | 'balanceCents' | 'archivedAt'>[],
  today: string,
): PaymentSuggestion[] {
  return plan.loans.flatMap((l) => {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a || a.archivedAt || a.source !== 'manual') return [];
    const owed = owedCents(a.balanceCents);
    if (!isDue({ ...l, owedCents: owed }, today)) return [];
    return [
      {
        plan: l,
        name: a.name,
        beforeCents: owed,
        afterCents: stepBalance(owed, l.aprMilliPct, l.paymentCents - l.escrowCents),
      },
    ];
  });
}

/** The plan's loans in one group, matched to their accounts (archived or missing ones drop out). */
export function planLoans(
  plan: DebtPlan,
  accounts: Pick<Account, 'id' | 'name' | 'balanceCents' | 'archivedAt'>[],
  group: DebtLoanPlan['group'],
): { plan: DebtLoanPlan; name: string; owedCents: number }[] {
  return plan.loans
    .filter((l) => l.group === group)
    .flatMap((l) => {
      const a = accounts.find((x) => x.id === l.accountId);
      return a && !a.archivedAt
        ? [{ plan: l, name: a.name, owedCents: owedCents(a.balanceCents) }]
        : [];
    });
}

/** Why a loan has no payoff date, so the page says what to fix instead of going blank. */
export const payoffGap = (
  r: Pick<LoanRow, 'done' | 'payoffPeriod' | 'plan'>,
): 'no-payment' | 'too-low' | null =>
  r.done || r.payoffPeriod !== null ? null : r.plan.paymentCents === 0 ? 'no-payment' : 'too-low';

/** One what-if. Nothing here is saved; only extra and strategy can be applied to the plan. */
export interface Scenario {
  extraCents: number;
  lumpCents: number;
  /** Month the lump goes in, "2026-11". */
  lumpPeriod: string;
  /** Where the lump goes: by rule, or one loan first. */
  target: Strategy | { loanId: string };
  /** Loans paid off in full today. */
  payOffIds: string[];
}

export interface ScenarioView {
  debtFreePeriod: string | null;
  interestCents: number;
  /** Against the plan as it stands; null when either side never finishes. */
  monthsSooner: number | null;
  interestSavedCents: number | null;
  /** Cash out the door: the lump plus any payoffs. */
  upfrontCents: number;
  payoffs: { name: string; payoffPeriod: string | null }[];
}

export function scenarioView(
  loans: { plan: DebtLoanPlan; name: string; owedCents: number }[],
  opts: { extraCents: number; strategy: Strategy; rollForward: boolean },
  s: Scenario,
  period: string,
): ScenarioView {
  const debtLoans = loans.map((l) => ({
    id: l.plan.accountId,
    balanceCents: l.owedCents,
    aprMilliPct: l.plan.aprMilliPct,
    paymentCents: l.plan.paymentCents,
  }));
  const base = simulatePayoff(debtLoans, opts);
  const payOffs = loans.filter((l) => s.payOffIds.includes(l.plan.accountId));
  const payOffCents = payOffs.reduce((n, l) => n + l.owedCents, 0);
  const lumps: Lump[] = [
    ...payOffs.map((l) => ({ month: 0, cents: l.owedCents, ids: [l.plan.accountId] })),
    ...(s.lumpCents > 0
      ? [
          {
            month: Math.max(0, monthsBetween(period, s.lumpPeriod)),
            cents: s.lumpCents,
            ...(typeof s.target === 'string' ? { strategy: s.target } : { ids: [s.target.loanId] }),
          },
        ]
      : []),
  ];
  const r = simulatePayoff(debtLoans, { ...opts, extraCents: s.extraCents, lumps });
  const sooner =
    base.debtFreeMonth !== null && r.debtFreeMonth !== null
      ? base.debtFreeMonth - r.debtFreeMonth
      : null;
  return {
    debtFreePeriod: r.debtFreeMonth === null ? null : addMonths(period, r.debtFreeMonth),
    interestCents: r.totalInterestCents,
    monthsSooner: sooner,
    interestSavedCents: sooner === null ? null : base.totalInterestCents - r.totalInterestCents,
    upfrontCents: s.lumpCents + payOffCents,
    payoffs: loans.map((l, i) => {
      const m = r.loans[i]?.payoffMonth ?? null;
      return { name: l.name, payoffPeriod: m === null ? null : addMonths(period, m) };
    }),
  };
}

/** Up to ~48 evenly spaced points, always ending at the last month. */
export function chartPoints(view: GroupView, period: string) {
  const total = view.rows.length;
  const owed = view.totalOwedByMonth;
  const step = Math.max(1, Math.ceil((owed.length - 1) / 48));
  const idx = Array.from({ length: Math.ceil((owed.length - 1) / step) + 1 }, (_, i) =>
    Math.min(i * step, owed.length - 1),
  );
  return idx.map((i) => ({
    cents: owed[i] ?? 0,
    inferred: false,
    label: `${monthName(addMonths(period, i))} · ${
      view.rows.filter(
        (r) => r.done || (r.payoffPeriod !== null && r.payoffPeriod <= addMonths(period, i)),
      ).length
    } of ${total} paid off`,
  }));
}
