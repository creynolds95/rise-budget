import { normalizeMerchant } from '@rise/shared/categorize';
import {
  SimpleFinAccount,
  toIncomingAccount,
  toIncomingTxn,
  type IncomingAccount,
} from '@rise/shared/import';
import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import { detectTransfers, planAccountSync, type IncomingWithMerchant } from '@rise/shared/sync';
import { z } from 'zod';
import {
  displayNamesFor,
  dropPendingStmts,
  finishSyncRun,
  getUser,
  insertSyncedAccountStmt,
  insertSyncedTxnStmt,
  linkTransferStmts,
  listStoredForSync,
  listSyncedAccounts,
  listTransferCandidates,
  newId,
  reportBalanceStmts,
  splitsFor,
  startSyncRun,
  updateSyncedTxnStmts,
  type SyncedAccountRow,
  type UserId,
} from '../db';
import { suggestFor } from '../lib/categorize';
import { localToday } from '../lib/dates';
import { refreshRecurring } from '../lib/recurring';
import type { SimpleFinSource } from './source';

/** Overlap re-fetched on every sync to absorb late posts (ARCHITECTURE §6). */
export const OVERLAP_DAYS = 5;

const Envelope = z.object({
  errors: z.array(z.string()).default([]),
  accounts: z.array(z.unknown()),
});

export interface SyncResult {
  id: string;
  status: 'ok' | 'partial' | 'failed';
  accountsTouched: number;
  rowsInserted: number;
  rowsUpdated: number;
  transfersLinked: number;
  errors: { account?: string; message: string }[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error');

/**
 * Where this sync starts: an explicit date, else each account's last report minus the
 * overlap — but never before the month the account was first seen, so a monthly account
 * (Apple) doesn't drag pre-Rise history into the review queue. The current month is always
 * re-read in full (about 175 rows), which catches late edits for free. A first sync
 * therefore starts at the 1st: Rise budgets from now on.
 */
export function windowStart(accounts: SyncedAccountRow[], today: string, since?: string): string {
  if (since) return since;
  const monthStart = (date: string) => dayNumber(`${date.slice(0, 7)}-01`);
  const starts = accounts
    .filter((a) => !a.archived_at)
    .map((a) =>
      a.last_synced_at
        ? Math.max(
            dayNumber(a.last_synced_at.slice(0, 10)) - OVERLAP_DAYS,
            monthStart(a.created_at),
          )
        : monthStart(today),
    );
  return dateFromDayNumber(Math.min(monthStart(today), ...starts));
}

/**
 * One sync (SPEC §6.1, ARCHITECTURE §6). Each account is one atomic batch: a failing account
 * is recorded and skipped without touching the others. Nothing here categorises money —
 * new rows arrive in the review queue with suggestions only.
 */
export async function runSync(
  db: D1Database,
  userId: UserId,
  source: SimpleFinSource,
  opts: { now?: Date; since?: string } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const runId = await startSyncRun(userId, db);
  const errors: SyncResult['errors'] = [];
  let accountsTouched = 0;
  let rowsInserted = 0;
  let rowsUpdated = 0;
  let transfersLinked = 0;

  const finish = async (): Promise<SyncResult> => {
    const status: SyncResult['status'] =
      errors.length === 0 ? 'ok' : accountsTouched > 0 ? 'partial' : 'failed';
    const r = { status, accountsTouched, rowsInserted, rowsUpdated, errors };
    await finishSyncRun(userId, db, runId, r);
    return { id: runId, ...r, transfersLinked };
  };

  const [user, known] = await Promise.all([getUser(userId, db), listSyncedAccounts(userId, db)]);
  const tz = user?.timezone ?? 'America/Chicago';
  const today = localToday(tz, now);
  const from = windowStart(known, today, opts.since);
  // A day early in UTC so no local date in the window is missed; the planner dedupes.
  const startSec = (dayNumber(from) - 1) * 86_400;

  let envelope: z.infer<typeof Envelope>;
  try {
    envelope = Envelope.parse(await source.fetchAccounts(startSec));
  } catch (e) {
    errors.push({
      message: e instanceof z.ZodError ? 'SimpleFIN returned an unexpected shape' : message(e),
    });
    return finish();
  }
  for (const m of envelope.errors) errors.push({ message: m });

  let earliest = today;
  for (const raw of envelope.accounts) {
    let label = 'unknown account';
    try {
      const sf = SimpleFinAccount.parse(raw);
      label = sf.name;
      const acct: IncomingAccount = toIncomingAccount(sf, tz);
      const existing = known.find((a) => a.source_account_id === acct.sourceAccountId);
      if (existing?.archived_at) continue; // the user unlinked it
      const accountId = existing?.id ?? newId();

      const incoming: IncomingWithMerchant[] = sf.transactions.map((t) => {
        const i = toIncomingTxn(t, tz);
        return { ...i, merchant: normalizeMerchant(i.descriptor) };
      });
      const stored = existing ? await listStoredForSync(userId, db, accountId, from) : [];
      const ops = planAccountSync(stored, incoming, today);

      const inserts = ops.flatMap((o) => (o.kind === 'insert' ? [{ id: newId(), ...o }] : []));
      const touchedIds = ops.flatMap((o) => (o.kind === 'insert' ? [] : [o.id]));
      const [suggestions, names, splits] = await Promise.all([
        suggestFor(
          db,
          userId,
          inserts.map((o) => ({
            id: o.id,
            descriptor: o.incoming.descriptor,
            merchant: o.incoming.merchant,
          })),
        ),
        displayNamesFor(
          userId,
          db,
          inserts.map((o) => o.incoming.merchant),
        ),
        splitsFor(userId, db, touchedIds),
      ]);
      const rowById = new Map(stored.map((s) => [s.id, s.row]));

      const stmts: D1PreparedStatement[] = [];
      if (!existing) stmts.push(insertSyncedAccountStmt(userId, db, accountId, acct));
      const insertAt = stmts.length;
      for (const o of inserts) {
        const s = suggestions.get(o.id);
        stmts.push(
          insertSyncedTxnStmt(userId, db, {
            id: o.id,
            accountId,
            incoming: o.incoming,
            merchant: o.incoming.merchant,
            merchantDisplay: names.get(o.incoming.merchant) ?? null,
            suggestedCategoryId: s?.categoryId ?? null,
            suggestionConfidence: s?.confidence ?? 0,
          }),
        );
      }
      let updates = 0;
      for (const o of ops) {
        if (o.kind === 'insert') continue;
        const row = rowById.get(o.id);
        if (!row) continue;
        const rowSplits = splits.get(o.id) ?? [];
        if (o.kind === 'update') {
          stmts.push(
            ...updateSyncedTxnStmts(userId, db, row, rowSplits, o.incoming, o.incoming.merchant),
          );
        } else {
          stmts.push(...dropPendingStmts(userId, db, row, rowSplits));
        }
        updates++;
      }
      stmts.push(
        ...reportBalanceStmts(
          userId,
          db,
          accountId,
          acct,
          new Date(sf['balance-date'] * 1000).toISOString(),
        ),
      );

      const results = await db.batch(stmts);
      accountsTouched++;
      rowsInserted += results
        .slice(insertAt, insertAt + inserts.length)
        .reduce((n, r) => n + r.meta.changes, 0);
      rowsUpdated += updates;
      for (const i of incoming) if (i.postedAt < earliest) earliest = i.postedAt;
    } catch (e) {
      errors.push({ account: label, message: message(e) });
    }
  }

  // Transfers across every account, over the window touched (SPEC §3.3). Only high-confidence
  // pairs link automatically; they stay in the review queue as a pair.
  try {
    const lo = dateFromDayNumber(Math.min(dayNumber(from), dayNumber(earliest)) - 4);
    const hi = dateFromDayNumber(dayNumber(today) + 4);
    const candidates = await listTransferCandidates(userId, db, lo, hi);
    const pairs = detectTransfers(
      candidates.map((c) => ({
        id: c.id,
        accountId: c.account_id,
        accountKind: c.kind,
        postedAt: c.posted_at,
        amountCents: c.amount_cents,
      })),
    ).filter((p) => p.confidence === 'high');
    if (pairs.length > 0) {
      await db.batch(pairs.flatMap((p) => linkTransferStmts(userId, db, p.a, p.b)));
      transfersLinked = pairs.length;
    }
  } catch (e) {
    errors.push({ message: `Transfer detection: ${message(e)}` });
  }

  try {
    await refreshRecurring(db, userId, today);
  } catch (e) {
    errors.push({ message: `Recurring detection: ${message(e)}` });
  }

  return finish();
}
