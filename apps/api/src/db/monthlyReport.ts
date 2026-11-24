import type { UserId } from './util';

/** The monthly report cache (migration 0038). One row per user per month. */

export interface ReportRow {
  period_id: string;
  generated_at: string;
  model: string;
  data_json: string;
  narrative_json: string;
}

export async function getReportRow(
  userId: UserId,
  db: D1Database,
  periodId: string,
): Promise<ReportRow | null> {
  return db
    .prepare(
      `SELECT period_id, generated_at, model, data_json, narrative_json
       FROM monthly_report WHERE user_id = ?1 AND period_id = ?2`,
    )
    .bind(userId, periodId)
    .first<ReportRow>();
}

export async function saveReportRow(
  userId: UserId,
  db: D1Database,
  row: {
    periodId: string;
    generatedAt: string;
    model: string;
    dataJson: string;
    narrativeJson: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO monthly_report (user_id, period_id, generated_at, model, data_json,
         narrative_json, input_tokens, output_tokens)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (user_id, period_id) DO UPDATE SET
         generated_at = excluded.generated_at, model = excluded.model,
         data_json = excluded.data_json, narrative_json = excluded.narrative_json,
         input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens`,
    )
    .bind(
      userId,
      row.periodId,
      row.generatedAt,
      row.model,
      row.dataJson,
      row.narrativeJson,
      row.inputTokens,
      row.outputTokens,
    )
    .run();
}

/** Months that have a stored report, newest first. A handful of rows per year. */
export async function listReportMonths(userId: UserId, db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT period_id FROM monthly_report WHERE user_id = ?1 ORDER BY period_id DESC')
    .bind(userId)
    .all<{ period_id: string }>();
  return results.map((r) => r.period_id);
}

/**
 * Money moved into the user's investment accounts, from transactions posted in
 * (afterDate, throughDate]. Money in is negative in the ledger, so the sum is negated. Driven
 * from the (few) investment accounts so each read is a range on the feed index.
 * `tracked` is whether any such transaction exists at all.
 */
export async function investmentInflow(
  userId: UserId,
  db: D1Database,
  afterDate: string,
  throughDate: string,
): Promise<{ cents: number; tracked: boolean }> {
  const row = await db
    .prepare(
      `SELECT COALESCE(-SUM(t.amount_cents), 0) AS cents, COUNT(t.id) AS n
       FROM account a
       JOIN txn t ON t.user_id = a.user_id AND t.account_id = a.id
       WHERE a.user_id = ?1 AND a.kind = 'investment' AND a.archived_at IS NULL
         AND t.posted_at > ?2 AND t.posted_at <= ?3
         AND t.amount_cents < 0 AND t.review_state != 'dropped'`,
    )
    .bind(userId, afterDate, throughDate)
    .first<{ cents: number; n: number }>();
  return { cents: row?.cents ?? 0, tracked: (row?.n ?? 0) > 0 };
}
