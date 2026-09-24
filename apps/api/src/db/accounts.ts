import {
  Account,
  type AccountKind,
  type AccountSource,
  type PatchAccountBody,
} from '@rise/shared/schemas';
import { bool, newId, nowIso, type UserId } from './util';

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  source: string;
  source_account_id: string | null;
  institution_name: string | null;
  mask: string | null;
  currency: string;
  balance_cents: number;
  include_in_net_worth: number;
  include_in_budget: number;
  expected_payment_cents: number | null;
  payment_day: number | null;
  sync_cadence_hours: number | null;
  last_synced_at: string | null;
  archived_at: string | null;
  created_at: string;
}

const toAccount = (r: AccountRow): Account =>
  Account.parse({
    id: r.id,
    name: r.name,
    kind: r.kind,
    source: r.source,
    sourceAccountId: r.source_account_id,
    institutionName: r.institution_name,
    mask: r.mask,
    currency: r.currency,
    balanceCents: r.balance_cents,
    includeInNetWorth: r.include_in_net_worth === 1,
    includeInBudget: r.include_in_budget === 1,
    expectedPaymentCents: r.expected_payment_cents,
    paymentDay: r.payment_day,
    syncCadenceHours: r.sync_cadence_hours,
    lastSyncedAt: r.last_synced_at,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
  });

export async function listAccounts(userId: UserId, db: D1Database): Promise<Account[]> {
  const { results } = await db
    .prepare('SELECT * FROM account WHERE user_id = ?1 AND archived_at IS NULL ORDER BY kind, name')
    .bind(userId)
    .all<AccountRow>();
  return results.map(toAccount);
}

export async function getAccount(
  userId: UserId,
  db: D1Database,
  id: string,
): Promise<Account | null> {
  const row = await db
    .prepare('SELECT * FROM account WHERE user_id = ?1 AND id = ?2')
    .bind(userId, id)
    .first<AccountRow>();
  return row ? toAccount(row) : null;
}

export interface NewAccount {
  name: string;
  kind: AccountKind;
  source: AccountSource;
  sourceAccountId?: string | null;
  institutionName?: string | null;
  mask?: string | null;
  balanceCents?: number;
  includeInNetWorth?: boolean;
  includeInBudget?: boolean;
  expectedPaymentCents?: number | null;
  paymentDay?: number | null;
  syncCadenceHours?: number | null;
}

export async function createAccount(
  userId: UserId,
  db: D1Database,
  a: NewAccount,
): Promise<Account> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO account (id, user_id, name, kind, source, source_account_id, institution_name, mask,
         balance_cents, include_in_net_worth, include_in_budget, expected_payment_cents, payment_day,
         sync_cadence_hours, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    )
    .bind(
      id,
      userId,
      a.name,
      a.kind,
      a.source,
      a.sourceAccountId ?? null,
      a.institutionName ?? null,
      a.mask ?? null,
      a.balanceCents ?? 0,
      bool(a.includeInNetWorth ?? true),
      bool(a.includeInBudget ?? true),
      a.expectedPaymentCents ?? null,
      a.paymentDay ?? null,
      a.syncCadenceHours ?? null,
      nowIso(),
    )
    .run();
  return (await getAccount(userId, db, id)) as Account;
}

export type AccountPatch = PatchAccountBody;

const PATCH_COLUMNS: Record<keyof AccountPatch, string> = {
  name: 'name',
  kind: 'kind',
  institutionName: 'institution_name',
  includeInNetWorth: 'include_in_net_worth',
  includeInBudget: 'include_in_budget',
  expectedPaymentCents: 'expected_payment_cents',
  paymentDay: 'payment_day',
  syncCadenceHours: 'sync_cadence_hours',
};

export async function updateAccount(
  userId: UserId,
  db: D1Database,
  id: string,
  patch: AccountPatch,
): Promise<Account | null> {
  const entries = (Object.keys(PATCH_COLUMNS) as (keyof AccountPatch)[])
    .filter((k) => patch[k] !== undefined)
    .map(
      (k) =>
        [
          PATCH_COLUMNS[k],
          typeof patch[k] === 'boolean' ? bool(patch[k] as boolean) : patch[k],
        ] as const,
    );
  if (entries.length > 0) {
    const sets = entries.map(([col], i) => `${col} = ?${i + 3}`).join(', ');
    await db
      .prepare(`UPDATE account SET ${sets} WHERE user_id = ?1 AND id = ?2`)
      .bind(userId, id, ...entries.map(([, v]) => v ?? null))
      .run();
  }
  return getAccount(userId, db, id);
}

// ── balance snapshots ─────────────────────────────────────────────────────────

export interface SnapshotRow {
  account_id: string;
  as_of: string;
  balance_cents: number;
}

/** Upsert on (account, date). If it is the newest snapshot, it becomes the current balance. */
export async function putSnapshot(
  userId: UserId,
  db: D1Database,
  accountId: string,
  s: { asOf: string; balanceCents: number; source: 'manual' | 'sync' },
): Promise<void> {
  await db.batch(putSnapshotStmts(userId, db, accountId, s));
}

/** A snapshot, and the account's current balance if this is its latest one. */
export function putSnapshotStmts(
  userId: UserId,
  db: D1Database,
  accountId: string,
  s: { asOf: string; balanceCents: number; source: 'manual' | 'sync' },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO balance_snapshot (id, user_id, account_id, as_of, balance_cents, source, created_at)
         SELECT ?3, ?1, ?2, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM account WHERE user_id = ?1 AND id = ?2)
         ON CONFLICT(account_id, as_of) DO UPDATE SET balance_cents = excluded.balance_cents, source = excluded.source
         WHERE balance_snapshot.user_id = ?1`,
      )
      .bind(userId, accountId, newId(), s.asOf, s.balanceCents, s.source, nowIso()),
    db
      .prepare(
        `UPDATE account SET balance_cents = ?3 WHERE user_id = ?1 AND id = ?2
         AND NOT EXISTS (SELECT 1 FROM balance_snapshot WHERE user_id = ?1 AND account_id = ?2 AND as_of > ?4)`,
      )
      .bind(userId, accountId, s.balanceCents, s.asOf),
  ];
}

export async function listSnapshots(
  userId: UserId,
  db: D1Database,
  opts: { accountId?: string; to?: string } = {},
): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT account_id, as_of, balance_cents FROM balance_snapshot
       WHERE user_id = ?1 AND (?2 IS NULL OR account_id = ?2) AND (?3 IS NULL OR as_of <= ?3)
       ORDER BY account_id, as_of`,
    )
    .bind(userId, opts.accountId ?? null, opts.to ?? null)
    .all<SnapshotRow>();
  return results;
}
