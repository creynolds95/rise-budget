import type { PeriodStatus, RolloverPolicy } from '../schemas/enums';
import { categoryMath } from './category';
import { assertCents, sumCents, type Cents } from './money';
import {
  comparePeriods,
  hasEnded,
  nextPeriod,
  periodEnd,
  type IsoDate,
  type PeriodId,
} from './period';

// ── §2.2 rollover ─────────────────────────────────────────────────────────────

export interface CarryOut {
  carriedOutCents: Cents;
  /** Surplus handed back to the pool by a `return_to_pool` category. */
  returnedCents: Cents;
}

/**
 * The policy governs surplus only. Deficits ALWAYS carry, whatever the policy (edge 7).
 */
export function computeCarryOut(policy: RolloverPolicy, remainingCents: Cents): CarryOut {
  assertCents(remainingCents, 'remainingCents');
  if (remainingCents < 0) return { carriedOutCents: remainingCents, returnedCents: 0 };
  if (policy === 'roll') return { carriedOutCents: remainingCents, returnedCents: 0 };
  return { carriedOutCents: 0, returnedCents: remainingCents };
}

// ── §2.4 close ────────────────────────────────────────────────────────────────

export interface CloseCategory {
  categoryId: string;
  rolloverPolicy: RolloverPolicy;
  carriedInCents: Cents;
  plannedCents: Cents;
  spentCents: Cents;
}

export interface PeriodCloseInput {
  periodId: PeriodId;
  status: PeriodStatus;
  expectedIncomeCents: Cents;
  /** Income actually received this period, as a positive magnitude. */
  actualIncomeCents: Cents;
  /** `settings.roll_income_variance` (SPEC §2.3), default on. */
  rollIncomeVariance: boolean;
  categories: readonly CloseCategory[];
}

export interface CloseOutcome {
  periodId: PeriodId;
  nextPeriodId: PeriodId;
  /** To be written as `allocation(P+1, c).carried_in_cents`. */
  carryIn: { categoryId: string; carriedInCents: Cents }[];
  /** To be written as `P.returned_surplus_cents`. */
  returnedSurplusCents: Cents;
}

/**
 * The arithmetic of closing a period, with no status checks. Deterministic: the same
 * input always yields the same outcome, which is what makes close idempotent.
 */
export function computeClose(input: PeriodCloseInput): CloseOutcome {
  const carryIn: CloseOutcome['carryIn'] = [];
  const returned: Cents[] = [];
  for (const c of input.categories) {
    const { remainingCents } = categoryMath(c);
    const out = computeCarryOut(c.rolloverPolicy, remainingCents);
    carryIn.push({ categoryId: c.categoryId, carriedInCents: out.carriedOutCents });
    returned.push(out.returnedCents);
  }
  const variance = input.rollIncomeVariance
    ? assertCents(input.actualIncomeCents, 'actualIncomeCents') -
      assertCents(input.expectedIncomeCents, 'expectedIncomeCents')
    : 0;
  return {
    periodId: input.periodId,
    nextPeriodId: nextPeriod(input.periodId),
    carryIn,
    returnedSurplusCents: sumCents(returned) + variance,
  };
}

// ── close readiness (§2.4, edge 10c) ──────────────────────────────────────────

export interface ReadinessAccount {
  accountId: string;
  name: string;
  source: 'simplefin' | 'manual';
  includeInBudget: boolean;
  /** Local date of the account's last sync, or null if it has never reported. */
  lastSyncedDate: IsoDate | null;
}

export interface CloseReadiness {
  ready: boolean;
  /** Budget accounts that have not yet reported past period end — named in the UI. */
  waitingOn: { accountId: string; name: string; lastSyncedDate: IsoDate | null }[];
}

export function closeReadiness(
  periodId: PeriodId,
  accounts: readonly ReadinessAccount[],
): CloseReadiness {
  const end = periodEnd(periodId);
  const waitingOn = accounts
    .filter((a) => a.includeInBudget && a.source === 'simplefin')
    .filter((a) => a.lastSyncedDate === null || a.lastSyncedDate <= end)
    .map(({ accountId, name, lastSyncedDate }) => ({ accountId, name, lastSyncedDate }));
  return { ready: waitingOn.length === 0, waitingOn };
}

export type CloseResult =
  | { kind: 'closed'; outcome: CloseOutcome; overridden: boolean }
  | { kind: 'already_closed' }
  | { kind: 'not_ended' }
  | { kind: 'waiting'; waitingOn: CloseReadiness['waitingOn'] };

/**
 * `close(P)` from SPEC §2.4. Never called by a background job — only on user confirm.
 * Re-closing a closed period is a no-op (`already_closed`), never a restatement.
 */
export function closePeriod(
  input: PeriodCloseInput,
  opts: { today: IsoDate; readiness: CloseReadiness; override: boolean },
): CloseResult {
  if (input.status === 'closed') return { kind: 'already_closed' };
  if (!hasEnded(input.periodId, opts.today)) return { kind: 'not_ended' };
  if (!opts.readiness.ready && !opts.override) {
    return { kind: 'waiting', waitingOn: opts.readiness.waitingOn };
  }
  return { kind: 'closed', outcome: computeClose(input), overridden: !opts.readiness.ready };
}

// ── §2.5 late arrivals ────────────────────────────────────────────────────────

export interface RecalcFlags {
  status: PeriodStatus;
  needsRecalc: boolean;
  recalcDeltaCents: Cents;
}

/**
 * A split was inserted/changed in this period by `deltaCents`. If the period is closed,
 * flag it — and do nothing else. Recalculation only ever happens on user request (edge 5).
 */
export function recordSplitChange(period: RecalcFlags, deltaCents: Cents): RecalcFlags {
  assertCents(deltaCents, 'deltaCents');
  if (period.status === 'open' || deltaCents === 0) return period;
  return {
    status: period.status,
    needsRecalc: true,
    recalcDeltaCents: period.recalcDeltaCents + deltaCents,
  };
}

/** "Leave as is": keep the frozen numbers and clear the flag. */
export function dismissRecalc(period: RecalcFlags): RecalcFlags {
  return { status: period.status, needsRecalc: false, recalcDeltaCents: 0 };
}

export class RecalcError extends Error {
  override readonly name = 'RecalcError';
}

/**
 * "Recalculate carry-forward": re-run close for P and cascade forward through every
 * subsequent closed period, in order (SPEC §2.5). `periods` is P and every later period,
 * contiguous and ascending, each with its *currently stored* inputs. Stops at the first
 * open period, whose carry-in is written by the last outcome.
 */
export function recalculateCascade(periods: readonly PeriodCloseInput[]): CloseOutcome[] {
  const first = periods[0];
  if (!first) throw new RecalcError('nothing to recalculate');
  if (first.status !== 'closed') throw new RecalcError(`${first.periodId} is not closed`);

  const outcomes: CloseOutcome[] = [];
  let carried: Map<string, Cents> | null = null;
  let expected = first.periodId;
  for (const p of periods) {
    if (comparePeriods(p.periodId, expected) !== 0) {
      throw new RecalcError(`expected ${expected}, got ${p.periodId}`);
    }
    if (p.status === 'open') break;
    const prior = carried;
    const input: PeriodCloseInput = prior
      ? {
          ...p,
          categories: p.categories.map((c) => ({
            ...c,
            carriedInCents: prior.get(c.categoryId) ?? 0,
          })),
        }
      : p;
    const outcome = computeClose(input);
    outcomes.push(outcome);
    carried = new Map(outcome.carryIn.map((c) => [c.categoryId, c.carriedInCents]));
    expected = outcome.nextPeriodId;
  }
  return outcomes;
}
