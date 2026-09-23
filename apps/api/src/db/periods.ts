import { Period } from '@rise/shared/schemas';
import { nowIso, type UserId } from './util';

interface PeriodRow {
  id: string;
  status: string;
  expected_income_cents: number;
  returned_surplus_cents: number;
  needs_recalc: number;
  recalc_delta_cents: number;
  closed_at: string | null;
}

const toPeriod = (r: PeriodRow): Period =>
  Period.parse({
    id: r.id,
    status: r.status,
    expectedIncomeCents: r.expected_income_cents,
    returnedSurplusCents: r.returned_surplus_cents,
    needsRecalc: r.needs_recalc === 1,
    recalcDeltaCents: r.recalc_delta_cents,
    closedAt: r.closed_at,
  });

/** A month with no row yet is an open month with no income set — not an error. */
export const blankPeriod = (id: string): Period => ({
  id,
  status: 'open',
  expectedIncomeCents: 0,
  returnedSurplusCents: 0,
  needsRecalc: false,
  recalcDeltaCents: 0,
  closedAt: null,
});

export async function getPeriod(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<Period | null> {
  const row = await db
    .prepare('SELECT * FROM period WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<PeriodRow>();
  return row ? toPeriod(row) : null;
}

export function ensurePeriodStmt(userId: UserId, db: D1Database, id: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO period (id, user_id) VALUES (?2, ?1) ON CONFLICT(user_id, id) DO NOTHING')
    .bind(userId, id);
}

export async function setExpectedIncome(
  userId: UserId,
  db: D1Database,
  id: string,
  cents: number,
): Promise<Period> {
  await db.batch([
    ensurePeriodStmt(userId, db, id),
    db
      .prepare('UPDATE period SET expected_income_cents = ?3 WHERE user_id = ?1 AND id = ?2')
      .bind(userId, id, cents),
  ]);
  return (await getPeriod(userId, db, id)) as Period;
}

// ── allocations ───────────────────────────────────────────────────────────────

export interface AllocationRow {
  category_id: string;
  planned_cents: number;
  carried_in_cents: number;
}

export async function listAllocations(
  userId: UserId,
  db: D1Database,
  periodId: string,
): Promise<AllocationRow[]> {
  const { results } = await db
    .prepare(
      'SELECT category_id, planned_cents, carried_in_cents FROM allocation WHERE user_id = ?1 AND period_id = ?2',
    )
    .bind(userId, periodId)
    .all<AllocationRow>();
  return results;
}

/** Deterministic id, so `/allocations/:id` works before the row exists. */
export const allocationId = (periodId: string, categoryId: string) => `${periodId}:${categoryId}`;

export function parseAllocationId(id: string): { periodId: string; categoryId: string } | null {
  const m = /^(\d{4}-\d{2}):(.+)$/.exec(id);
  return m ? { periodId: m[1] as string, categoryId: m[2] as string } : null;
}

/** Applies a planned-amount delta (upserting the row). Used inside an atomic batch. */
export function addPlannedStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  categoryId: string,
  deltaCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id, period_id, category_id) DO UPDATE SET planned_cents = planned_cents + excluded.planned_cents
       WHERE allocation.user_id = ?2`,
    )
    .bind(allocationId(periodId, categoryId), userId, periodId, categoryId, deltaCents);
}

export function insertReallocationStmt(
  userId: UserId,
  db: D1Database,
  r: {
    periodId: string;
    fromCategoryId: string | null;
    toCategoryId: string | null;
    amountCents: number;
    note: string | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO reallocation (id, user_id, period_id, from_category_id, to_category_id, amount_cents, note, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      r.periodId,
      r.fromCategoryId,
      r.toCategoryId,
      r.amountCents,
      r.note,
      nowIso(),
    );
}

export async function listReallocations(userId: UserId, db: D1Database, periodId: string) {
  const { results } = await db
    .prepare(
      `SELECT id, period_id, from_category_id, to_category_id, amount_cents, note, created_at
       FROM reallocation WHERE user_id = ?1 AND period_id = ?2 ORDER BY created_at, id`,
    )
    .bind(userId, periodId)
    .all<{
      id: string;
      period_id: string;
      from_category_id: string | null;
      to_category_id: string | null;
      amount_cents: number;
      note: string | null;
      created_at: string;
    }>();
  return results.map((r) => ({
    id: r.id,
    periodId: r.period_id,
    fromCategoryId: r.from_category_id,
    toCategoryId: r.to_category_id,
    amountCents: r.amount_cents,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// ── spending ──────────────────────────────────────────────────────────────────

/**
 * SPEC §2.1 `spent`, per category, for a period. Reads splits (never transactions),
 * excluding linked transfers and dropped pendings.
 */
export async function spentByCategory(
  userId: UserId,
  db: D1Database,
  periodId: string,
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT s.category_id, SUM(s.amount_cents) AS spent
       FROM split s JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       WHERE s.user_id = ?1 AND s.period_id = ?2 AND t.is_transfer = 0 AND t.review_state != 'dropped'
       GROUP BY s.category_id`,
    )
    .bind(userId, periodId)
    .all<{ category_id: string; spent: number }>();
  return new Map(results.map((r) => [r.category_id, r.spent]));
}
