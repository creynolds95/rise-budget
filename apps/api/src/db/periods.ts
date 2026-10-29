import { resolvePlanned, type PlanDefault } from '@rise/shared/budget';
import { Period } from '@rise/shared/schemas';
import { nowIso, type UserId } from './util';

interface PeriodRow {
  id: string;
  expected_income_cents: number;
}

const toPeriod = (r: PeriodRow): Period =>
  Period.parse({
    id: r.id,
    expectedIncomeCents: r.expected_income_cents,
  });

/** A month with no row yet has no income set — not an error. */
export const blankPeriod = (id: string): Period => ({ id, expectedIncomeCents: 0 });

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

/** Past months aren't frozen: expected income can be corrected any time, and carry follows. */
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
  carry_adjust_cents: number;
}

export async function listAllocations(
  userId: UserId,
  db: D1Database,
  periodId: string,
): Promise<AllocationRow[]> {
  const { results } = await db
    .prepare(
      'SELECT category_id, planned_cents, carry_adjust_cents FROM allocation WHERE user_id = ?1 AND period_id = ?2',
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

/**
 * Applies a planned-amount delta (upserting the row). Used inside an atomic batch. A new row
 * starts from `seedCents`, the month's resolved plan (SPEC §2.9), so creating it changes nothing.
 */
export function addPlannedStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  categoryId: string,
  deltaCents: number,
  seedCents = 0,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents) VALUES (?1, ?2, ?3, ?4, ?6 + ?5)
       ON CONFLICT(user_id, period_id, category_id) DO UPDATE SET planned_cents = planned_cents + ?5
       WHERE allocation.user_id = ?2`,
    )
    .bind(allocationId(periodId, categoryId), userId, periodId, categoryId, deltaCents, seedCents);
}

/** Writes a month's plan down if it has no row yet; an existing row is left alone. */
export function seedAllocationStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  categoryId: string,
  plannedCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id, period_id, category_id) DO NOTHING`,
    )
    .bind(allocationId(periodId, categoryId), userId, periodId, categoryId, plannedCents);
}

/** Sets the plan on an existing row. Only ever for open months after the one being edited. */
export function setPlannedStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  categoryId: string,
  plannedCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE allocation SET planned_cents = ?4
       WHERE user_id = ?1 AND period_id = ?2 AND category_id = ?3`,
    )
    .bind(userId, periodId, categoryId, plannedCents);
}

/** Months that have an allocation row for a category. */
export async function allocationPeriods(
  userId: UserId,
  db: D1Database,
  categoryId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      'SELECT period_id FROM allocation WHERE user_id = ?1 AND category_id = ?2 /* scan-ok: "apply to future months" edit */',
    )
    .bind(userId, categoryId)
    .all<{ period_id: string }>();
  return results.map((r) => r.period_id);
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
 * SPEC §2.1 `spent`, per category, for a period. Reads splits (never transactions), excluding
 * unbudgeted categories (pre-deploy A4 — transfers are just one, but any category can opt out)
 * and dropped pendings.
 */
export async function spentByCategory(
  userId: UserId,
  db: D1Database,
  periodId: string,
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT s.category_id, SUM(s.amount_cents) AS spent
       FROM split s
       JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
       JOIN category c ON c.id = s.category_id AND c.user_id = s.user_id
       WHERE s.user_id = ?1 AND s.period_id = ?2 AND c.budgeted = 1 AND t.review_state != 'dropped'
       GROUP BY s.category_id`,
    )
    .bind(userId, periodId)
    .all<{ category_id: string; spent: number }>();
  return new Map(results.map((r) => [r.category_id, r.spent]));
}

// ── live rollover inputs ──────────────────────────────────────────────────────

/** Every allocation in an inclusive range of months. */
export async function allocationsBetween(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<(AllocationRow & { period_id: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT period_id, category_id, planned_cents, carry_adjust_cents FROM allocation
       WHERE user_id = ?1 AND period_id BETWEEN ?2 AND ?3`,
    )
    .bind(userId, from, to)
    .all<AllocationRow & { period_id: string }>();
  return results;
}

/**
 * `spentByCategory` for an inclusive range of months. Read from `period_aggregate` (same rule:
 * budgeted categories, dropped pendings out), so the carry chain costs rows per month and
 * category rather than a scan of every split since the chain began.
 */
export async function spentBetween(
  userId: UserId,
  db: D1Database,
  from: string,
  to: string,
): Promise<{ period_id: string; category_id: string; spent: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT period_id, category_id, spent_cents AS spent FROM period_aggregate
       WHERE user_id = ?1 AND period_id BETWEEN ?2 AND ?3`,
    )
    .bind(userId, from, to)
    .all<{ period_id: string; category_id: string; spent: number }>();
  return results;
}

/**
 * SPEC §2.8: forgive a carried deficit. The carry itself is computed, so this records an
 * adjustment on the month that brings its carry-in back to zero.
 */
export function forgiveCarryStmt(
  userId: UserId,
  db: D1Database,
  periodId: string,
  categoryId: string,
  amountCents: number,
  /** The month's resolved plan, so creating the row changes nothing else (SPEC §2.9). */
  seedPlannedCents: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO allocation (id, user_id, period_id, category_id, planned_cents, carry_adjust_cents)
       VALUES (?1, ?2, ?3, ?4, ?6, ?5)
       ON CONFLICT(user_id, period_id, category_id)
         DO UPDATE SET carry_adjust_cents = carry_adjust_cents + ?5
       WHERE allocation.user_id = ?2`,
    )
    .bind(
      allocationId(periodId, categoryId),
      userId,
      periodId,
      categoryId,
      amountCents,
      seedPlannedCents,
    );
}

export interface CategoryHistoryRow {
  periodId: string;
  plannedCents: number;
  carriedInCents: number;
  spentCents: number;
}

/** One category month by month: its plan and carry, and what was spent (from aggregates). */
export async function categoryHistory(
  userId: UserId,
  db: D1Database,
  categoryId: string,
  from: string,
  to: string,
  planDefault: PlanDefault | null,
  carriedIn: (periodId: string) => number,
): Promise<CategoryHistoryRow[]> {
  const [alloc, agg] = await Promise.all([
    db
      .prepare(
        `SELECT period_id, planned_cents FROM allocation
         WHERE user_id = ?1 AND category_id = ?2 AND period_id BETWEEN ?3 AND ?4`,
      )
      .bind(userId, categoryId, from, to)
      .all<{ period_id: string; planned_cents: number }>(),
    db
      .prepare(
        `SELECT period_id, spent_cents FROM period_aggregate
         WHERE user_id = ?1 AND category_id = ?2 AND period_id BETWEEN ?3 AND ?4`,
      )
      .bind(userId, categoryId, from, to)
      .all<{ period_id: string; spent_cents: number }>(),
  ]);
  const spent = new Map(agg.results.map((r) => [r.period_id, r.spent_cents]));
  const plan = new Map(alloc.results.map((r) => [r.period_id, r]));
  const out: CategoryHistoryRow[] = [];
  for (let p = from; p <= to;) {
    const a = plan.get(p);
    out.push({
      periodId: p,
      plannedCents: resolvePlanned(a && { plannedCents: a.planned_cents }, planDefault, p),
      carriedInCents: carriedIn(p),
      spentCents: spent.get(p) ?? 0,
    });
    const [y, m] = [Number(p.slice(0, 4)), Number(p.slice(5, 7))];
    p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}
