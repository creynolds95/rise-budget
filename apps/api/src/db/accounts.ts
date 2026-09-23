import { Account, type AccountKind, type AccountSource } from '@rise/shared/schemas';
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
