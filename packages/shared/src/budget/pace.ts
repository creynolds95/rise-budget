import type { SpendShape } from '../schemas/enums';
import { assertCents, mulDiv, type Cents } from './money';
import type { Pace } from './period';

export interface PaceInput {
  spendShape: SpendShape;
  availableCents: Cents;
  spentCents: Cents;
  /** Fixed shape: has this period's bill posted? */
  billPosted: boolean;
  /** Fixed shape: learned day of month the bill usually posts (SPEC §7), if known. */
  typicalPostDay: number | null;
}

export type PaceStatus = 'under' | 'on' | 'over';

export interface PaceResult {
  /** What should have been spent by now. */
  expectedSpentCents: Cents;
  /** expected − spent. Positive = behind pace (good), negative = ahead of pace. */
  headroomCents: Cents;
  status: PaceStatus;
  /** Where the rail's pace tick sits, as a rational. `null` for fixed shape (no tick). */
  tick: Pace | null;
}

/**
 * SPEC §2.7, shape-aware. A fixed-shape category expects 0 until its bill posts (or its
 * typical post day arrives), so rent never reads as "overspent" on the 1st (edge 9).
 */
export function paceFor(input: PaceInput, p: Pace): PaceResult {
  const available = assertCents(input.availableCents, 'availableCents');
  const spent = assertCents(input.spentCents, 'spentCents');
  let expected: Cents;
  if (input.spendShape === 'linear') {
    expected = mulDiv(available, p.elapsedDays, p.totalDays);
  } else {
    const due =
      input.billPosted || (input.typicalPostDay !== null && p.elapsedDays >= input.typicalPostDay);
    expected = due ? available : 0;
  }
  const headroom = expected - spent;
  const status: PaceStatus = headroom > 0 ? 'under' : headroom === 0 ? 'on' : 'over';
  return {
    expectedSpentCents: expected,
    headroomCents: headroom,
    status,
    tick: input.spendShape === 'linear' ? p : null,
  };
}

// ── staleness (SPEC §2.7 "pace honesty") ──────────────────────────────────────

const HOUR_MS = 3_600_000;

/** Default cadences, in hours. Real values are learned per account (SPEC §5.1). */
export const SYNC_CADENCE_HOURS = { daily: 24, monthly: 720 } as const;

export interface StalenessInput {
  source: 'simplefin' | 'manual';
  /** Epoch ms of the last successful sync, or null if never synced. */
  lastSyncedAtMs: number | null;
  /** Expected cadence; null falls back to daily. */
  syncCadenceHours: number | null;
}

export type Staleness =
  | { stale: false }
  | { stale: true; reason: 'never_synced' }
  | { stale: true; reason: 'overdue'; lastSyncedAtMs: number; overdueByMs: number };

/**
 * An account is stale once it has gone 1.5× its *own* expected cadence without reporting.
 * A monthly account at 20 days is fresh (edge 10); at 45 days it is stale (edge 10b).
 * The threshold is inclusive: at exactly 1.5× cadence we warn — the conservative reading.
 * Never estimates what is missing; only says that it is.
 */
export function staleness(input: StalenessInput, nowMs: number): Staleness {
  if (input.source === 'manual') return { stale: false };
  if (input.lastSyncedAtMs === null) return { stale: true, reason: 'never_synced' };
  const cadence = input.syncCadenceHours ?? SYNC_CADENCE_HOURS.daily;
  const threshold = (cadence * 3 * HOUR_MS) / 2;
  const age = nowMs - input.lastSyncedAtMs;
  if (age < threshold) return { stale: false };
  return {
    stale: true,
    reason: 'overdue',
    lastSyncedAtMs: input.lastSyncedAtMs,
    overdueByMs: age - threshold,
  };
}
