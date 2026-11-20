import {
  bodyKeys,
  diffFields,
  type FieldChange,
  type FieldRule,
  type Snapshot,
} from '@rise/shared/activity';
import type { Context, MiddlewareHandler } from 'hono';
import { insertActivityStmt, snapshotEntity, type SnapshotEntity } from '../db';
import type { AppEnv } from '../env';

/**
 * The activity log's capture point: every mutating request the signed-in owner makes is
 * recorded once, after it ran, with how long it took and whether it worked. For the entities
 * that carry money or structure (transactions and their splits, categories, accounts, the
 * plan, settings) the row is read just before and just after, and the difference is stored.
 * Free text is never stored (see @rise/shared/activity). Best effort, after the response:
 * a logging fault cannot change what the owner's request did.
 */

const BODY_PEEK_MAX = 20_000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** First path segment → entity name. Anything not listed is recorded as its segment. */
const ENTITY: Record<string, string> = {
  transactions: 'txn',
  categories: 'category',
  'category-groups': 'category_group',
  accounts: 'account',
  periods: 'period',
  allocations: 'allocation',
  merchants: 'merchant',
  me: 'settings',
  'cash-to-payday': 'cash_plan',
};

const RULES: Record<SnapshotEntity, FieldRule> = {
  txn: {
    keep: [
      'amount_cents',
      'posted_at',
      'is_pending',
      'is_transfer',
      'paired',
      'review_state',
      'splits',
    ],
    text: ['notes', 'merchant_display'],
  },
  category: {
    keep: [
      'group_id',
      'rollover_policy',
      'spend_shape',
      'is_bill',
      'typical_post_day',
      'archived',
      'sort_order',
    ],
    text: ['name', 'emoji'],
  },
  category_group: { keep: ['kind', 'sort_order'], text: ['name'] },
  account: {
    keep: [
      'kind',
      'balance_cents',
      'include_in_net_worth',
      'include_in_budget',
      'expected_payment_cents',
      'payment_day',
      'sync_cadence_hours',
      'archived',
    ],
    text: ['name', 'nickname'],
  },
  period: { keep: ['status', 'expected_income_cents'], text: [] },
  allocation: { keep: ['period_id', 'category_id', 'planned_cents'], text: [] },
  // Settings hold free text (names, notes), so only which keys changed is kept.
  settings: { keep: [], text: [] },
};

const SNAPSHOTTED = new Set<string>(Object.keys(RULES));

function changesFor(
  entity: SnapshotEntity,
  before: Snapshot | null,
  after: Snapshot | null,
): FieldChange[] {
  if (entity !== 'settings') return diffFields(before, after, RULES[entity]);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return diffFields(before, after, { keep: [], text: keys }).map((c) => ({
    field: c.field,
    changed: true,
  }));
}

/** The `:id` segment of the matched route, read off the actual path (no router internals). */
export function idFrom(pattern: string, path: string): string | null {
  const want = pattern.split('/').indexOf(':id');
  const got = path.replace(/^\/api/, '').split('/')[want];
  return want > 0 && got ? decodeURIComponent(got) : null;
}

export const activityLog: MiddlewareHandler<AppEnv> = async (c: Context<AppEnv>, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const started = Date.now();
  const userId = c.get('userId');
  const matched = c.req.matchedRoutes.at(-1)?.path ?? c.req.path;
  const pattern = matched.replace(/^\/api/, '') || '/';
  // The log's own client reports are not edits.
  if (pattern.startsWith('/diagnostics')) return next();
  const entity = ENTITY[pattern.split('/')[1] ?? ''] ?? (pattern.split('/')[1] || 'api');
  // Settings are one row per user; every other snapshotted entity names its row in :id.
  const id = entity === 'settings' ? userId : idFrom(pattern, c.req.path);
  const snap = SNAPSHOTTED.has(entity) && id !== null ? (entity as SnapshotEntity) : null;
  const db = c.env.DB;

  let before: Snapshot | null = null;
  let keys: string[] = [];
  try {
    if (snap && id) before = await snapshotEntity(userId, db, snap, id);
    // Big bodies (a CSV import) are not parsed twice: the 10 ms CPU budget matters more.
    const size = Number(c.req.header('content-length') ?? 0);
    if (!snap && size > 0 && size <= BODY_PEEK_MAX) keys = bodyKeys(await c.req.raw.clone().json());
  } catch {
    // An unreadable body or a failed read just means a thinner log row.
  }

  await next();

  // A replayed request (offline queue) changed nothing the second time.
  if (c.res.headers.get('idempotent-replay')) return;
  const record = async () => {
    let changes: unknown = keys.length > 0 ? { keys } : null;
    if (snap && id) {
      const after = await snapshotEntity(userId, db, snap, id);
      changes = {
        fields: changesFor(snap, before, after),
        ...(before === null ? { created: true } : {}),
        ...(after === null ? { deleted: true } : {}),
      };
    }
    await insertActivityStmt(userId, db, {
      entity,
      entityId: entity === 'settings' ? null : id,
      action: `${c.req.method} ${pattern}`,
      status: c.res.status,
      ms: Date.now() - started,
      changes,
    }).run();
  };
  const safe = record().catch(() => undefined);
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    await safe; // no execution context (tests)
  }
};
