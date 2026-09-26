import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// T3: every table from ARCHITECTURE §3 exists after migrations.
const TABLES = [
  'user',
  'credential',
  'totp_secret',
  'recovery_code',
  'session',
  'account',
  'balance_snapshot',
  'category_group',
  'category',
  'period',
  'allocation',
  'reallocation',
  'txn',
  'split',
  'rule',
  'merchant_memory',
  'merchant_meta',
  'recurring_series',
  'sync_run',
  'import_batch',
  'audit_log',
  'idempotency',
  'period_aggregate',
];

const INDEXES = [
  'ux_txn_source',
  'ux_txn_dedupe',
  'ix_txn_account_date',
  'ix_txn_review',
  'ix_txn_merchant',
  'ix_split_period_cat',
  // 0009 (C19)
  'ix_split_txn',
  'ix_audit_action',
  'ix_idempotency_created',
  'ix_sync_run_started',
];

describe('migration 0001', () => {
  it('creates every table', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual([...TABLES].sort());
  });

  it('creates every index', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND (name LIKE 'ix_%' OR name LIKE 'ux_%')",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual([...INDEXES].sort());
  });

  it('stores money as INTEGER columns', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, type FROM pragma_table_info('txn') WHERE name = 'amount_cents'",
    ).all<{ type: string }>();
    expect(results[0]?.type).toBe('INTEGER');
  });
});
