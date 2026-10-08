import { periodOf } from '@rise/shared/budget';
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
  budgetedCategoryIds,
  displayNamesFor,
  dropPendingStmts,
  ensureCatchallCategory,
  ensureIncomeCatchallCategory,
  ensureTransferCategory,
  finishSyncRun,
  hadSyncRunSince,
  flagClosedPeriodStmt,
  getUser,
  insertSyncedAccountStmt,
  insertSyncedTxnStmt,
  linkTransferStmts,
  listStoredForSync,
  listSyncedAccounts,
  listTransferCandidates,
  newId,
  reassignSplitStmts,
  refreshAggregateStmts,
  reportBalanceStmts,
  splitsFor,
  startSyncRun,
  updateSyncedTxnStmts,
  type SyncedAccountRow,
  type UserId,
  deletedSourceIds,
} from '../db';
import { suggestFor } from '../lib/categorize';
import { localToday } from '../lib/dates';
import { refreshRecurring } from '../lib/recurring';
import type { FetchInfo, SimpleFinSource } from './source';

/** Overlap re-fetched on every sync to absorb late posts (ARCHITECTURE §6). */
export const OVERLAP_DAYS = 5;

/**
 * The wider overlap of the weekly deep re-read: a bank that backfills a row a week or more
 * late (a slow merchant, a corrected statement) is otherwise never fetched again. The planner
 * dedupes everything it has already seen, so a wide window costs reads, never duplicates.
 */
export const DEEP_OVERLAP_DAYS = 35;

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

const iso = (unixSeconds: unknown) =>
  typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

/**
 * What SimpleFIN sent, minus names and amounts: enough to tell "SimpleFIN hasn't refreshed
 * this bank" (an old balance-date) from "Rise dropped something" (transactions sent, none
 * stored). Tolerates any shape — it runs before validation.
 */
export function describeSource(raw: unknown, fetch?: FetchInfo, startDate?: string) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accounts = Array.isArray(r['accounts']) ? (r['accounts'] as unknown[]) : [];
  return {
    fetch: fetch ?? null,
    startDate: startDate ?? null,
    keys: Object.keys(r).sort(),
    accounts: accounts.map((a) => {
      const acct = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const org = (acct['org'] ?? {}) as Record<string, unknown>;
      const txns = Array.isArray(acct['transactions'])
        ? (acct['transactions'] as Record<string, unknown>[])
        : [];
      const posted = txns.map((t) => (typeof t['posted'] === 'number' ? t['posted'] : 0));
      return {
        id: typeof acct['id'] === 'string' ? acct['id'].slice(-4) : null,
        org: typeof org['name'] === 'string' ? org['name'] : null,
        balanceDate: iso(acct['balance-date']),
        txns: txns.length,
        pending: txns.filter((t) => t['pending'] === true || t['posted'] === 0).length,
        newestPosted: iso(Math.max(0, ...posted)),
      };
    }),
  };
}

/**
 * Where this sync starts: an explicit date, else each account's last report minus the
 * overlap — but never before the month the account was first seen, so a monthly account
 * (Apple) doesn't drag pre-Rise history into the review queue. The current month is always
 * re-read in full (about 175 rows), which catches late edits for free. A first sync
 * therefore starts at the 1st: Rise budgets from now on.
 */
export function windowStart(
  accounts: SyncedAccountRow[],
  today: string,
  since?: string,
  overlapDays = OVERLAP_DAYS,
): string {
  if (since) return since;
  const monthStart = (date: string) => dayNumber(`${date.slice(0, 7)}-01`);
  const starts = accounts
    .filter((a) => !a.archived_at)
    .map((a) =>
      a.last_synced_at
        ? Math.max(dayNumber(a.last_synced_at.slice(0, 10)) - overlapDays, monthStart(a.created_at))
        : monthStart(today),
    );
  return dateFromDayNumber(Math.min(monthStart(today), ...starts));
}

/**
 * One sync (SPEC §6.1, ARCHITECTURE §6). Each account is one atomic batch: a failing account
 * is recorded and skipped without touching the others. New rows arrive in the review queue
 * (H1) already carrying a real split — the best guess when there is one, the user's
 * catch-all category otherwise — so nothing is ever left uncategorised; review means
 * confirm-or-correct, not first-time filing.
 */
export async function runSync(
  db: D1Database,
  userId: UserId,
  source: SimpleFinSource,
  opts: {
    now?: Date;
    since?: string;
    /**
     * Cron runs: when nothing new arrived and an earlier sync already ran today, skip the
     * recurring re-detection. It re-reads three years of transactions (the biggest read in a
     * sync) and its inputs haven't changed. A manual sync always runs it.
     */
    skipRecurringWhenIdle?: boolean;
    /** How far before each account's last report to re-read; the weekly cron widens it. */
    overlapDays?: number;
  } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const runId = await startSyncRun(userId, db);
  const errors: SyncResult['errors'] = [];
  let accountsTouched = 0;
  let rowsInserted = 0;
  let rowsUpdated = 0;
  let transfersLinked = 0;
  let source_: ReturnType<typeof describeSource> | undefined;

  const finish = async (): Promise<SyncResult> => {
    const status: SyncResult['status'] =
      errors.length === 0 ? 'ok' : accountsTouched > 0 ? 'partial' : 'failed';
    const r = { status, accountsTouched, rowsInserted, rowsUpdated, errors };
    await finishSyncRun(userId, db, runId, { ...r, source: source_ });
    return { id: runId, ...r, transfersLinked };
  };

  const [user, known, other, otherIncome, transferCat] = await Promise.all([
    getUser(userId, db),
    listSyncedAccounts(userId, db),
    ensureCatchallCategory(userId, db),
    ensureIncomeCatchallCategory(userId, db),
    ensureTransferCategory(userId, db),
  ]);
  const tz = user?.timezone ?? 'America/Chicago';
  const today = localToday(tz, now);
  const from = windowStart(
    known.filter((a) => a.source === 'simplefin'),
    today,
    opts.since,
    opts.overlapDays,
  );
  // A day early in UTC so no local date in the window is missed; the planner dedupes.
  const startSec = (dayNumber(from) - 1) * 86_400;

  let envelope: z.infer<typeof Envelope>;
  try {
    const raw = await source.fetchAccounts(startSec);
    source_ = describeSource(raw, source.lastFetch, from);
    envelope = Envelope.parse(raw);
  } catch (e) {
    errors.push({
      message: e instanceof z.ZodError ? 'SimpleFIN returned an unexpected shape' : message(e),
    });
    return finish();
  }
  for (const m of envelope.errors) errors.push({ message: m });

  // Which categories count as spending, read once and only if some row is updated or dropped.
  let budgeted: Promise<ReadonlySet<string>> | undefined;
  const budgetedOnce = () => (budgeted ??= budgetedCategoryIds(userId, db));

  let earliest = today;
  for (const raw of envelope.accounts) {
    let label = 'unknown account';
    try {
      const sf = SimpleFinAccount.parse(raw);
      label = sf.name;
      const acct: IncomingAccount = toIncomingAccount(sf, tz);
      const existing = known.find((a) => a.source_account_id === acct.sourceAccountId);
      if (existing?.archived_at) continue; // the user unlinked it
      if (existing && existing.source !== 'simplefin') continue; // converted to manual
      const accountId = existing?.id ?? newId();

      const gone = existing ? await deletedSourceIds(userId, db, accountId) : new Set<string>();
      const incoming: IncomingWithMerchant[] = sf.transactions
        .map((t) => {
          const i = toIncomingTxn(t, tz, Math.floor(now.getTime() / 1000));
          return { ...i, merchant: normalizeMerchant(i.descriptor) };
        })
        // What the user deleted stays deleted, even while the bank keeps reporting it.
        .filter((i) => !i.sourceId || !gone.has(i.sourceId));
      // Stored rows from as far back as the bank sent any: a row it re-sends from just before
      // the window is then seen as known, not planned as an insert that conflicts.
      const sentFrom = incoming.reduce((d, i) => (i.postedAt < d ? i.postedAt : d), from);
      const stored = existing ? await listStoredForSync(userId, db, accountId, sentFrom) : [];
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
            amountCents: o.incoming.amountCents,
            accountKind: acct.kind,
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
      // Landing in a closed period is real money too (H1) — `flagClosedPeriodStmt` itself
      // no-ops on an open period, same as everywhere else that writes a split.
      const insertDeltaByPeriod = new Map<string, number>();
      // Every period whose splits this batch changes; each is refreshed once, at the end of the
      // same batch, so the aggregate cache commits (or fails) with the rows it summarises.
      const touched = new Set<string>();
      for (const o of inserts) {
        const s = suggestions.get(o.id);
        const p = periodOf(o.incoming.postedAt);
        insertDeltaByPeriod.set(p, (insertDeltaByPeriod.get(p) ?? 0) + o.incoming.amountCents);
        stmts.push(
          ...insertSyncedTxnStmt(userId, db, {
            id: o.id,
            accountId,
            incoming: o.incoming,
            merchant: o.incoming.merchant,
            merchantDisplay: names.get(o.incoming.merchant) ?? null,
            suggestedCategoryId: s?.categoryId ?? null,
            suggestionConfidence: s?.confidence ?? 0,
            // C2: a deposit into a cash account with no match falls to the income catch-all,
            // never the expense-kind "Other" — that would silently net spending down. Off a
            // cash account (a card's own ledger runs the other way), direction is
            // meaningless, so it always falls to the plain catch-all.
            assignedCategoryId:
              s?.categoryId ??
              (acct.kind === 'depository' && o.incoming.amountCents < 0
                ? otherIncome.id
                : other.id),
          }),
        );
      }
      for (const [p, delta] of insertDeltaByPeriod) {
        stmts.push(flagClosedPeriodStmt(userId, db, p, delta));
        touched.add(p);
      }
      let updates = 0;
      const counts = touchedIds.length > 0 ? await budgetedOnce() : new Set<string>();
      for (const o of ops) {
        if (o.kind === 'insert') continue;
        const row = rowById.get(o.id);
        if (!row) continue;
        const rowSplits = splits.get(o.id) ?? [];
        stmts.push(
          ...(o.kind === 'update'
            ? updateSyncedTxnStmts(
                userId,
                db,
                row,
                rowSplits,
                o.incoming,
                o.incoming.merchant,
                counts,
                touched,
              )
            : dropPendingStmts(userId, db, row, rowSplits, counts, touched)),
        );
        updates++;
      }
      for (const p of touched) stmts.push(...refreshAggregateStmts(userId, db, p));
      stmts.push(
        ...reportBalanceStmts(
          userId,
          db,
          accountId,
          // A balance can't be as of a day the user hasn't reached yet; a later as_of would
          // fall outside a "through today" net worth read and drop the account from it (C7).
          { ...acct, balanceDate: acct.balanceDate > today ? today : acct.balanceDate },
          new Date(sf['balance-date'] * 1000).toISOString(),
        ),
      );

      const results = await db.batch(stmts);
      accountsTouched++;
      // Each insert is now two statements (txn, split — H1); count only the txn one, since a
      // skipped txn insert (edge 12, a re-fetched overlap) always skips its split too.
      rowsInserted += results
        .slice(insertAt, insertAt + inserts.length * 2)
        .filter((_, i) => i % 2 === 0)
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
    const candidates = await listTransferCandidates(userId, db, lo, hi, other.id);
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
      // H1/A5: every candidate already has a real split (its auto-guess or catch-all) that's
      // been counting as spending since insert. Linking defaults both legs to the unbudgeted
      // Transfer category, same as a manual transfer-link does — the user can recategorize
      // either leg later without affecting the pairing.
      const legSplits = await splitsFor(
        userId,
        db,
        pairs.flatMap((p) => [p.a, p.b]),
      );
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const reassign = async (id: string): Promise<D1PreparedStatement[]> => {
        const c = byId.get(id);
        const rowSplits = legSplits.get(id) ?? [];
        if (!c) return [];
        return reassignSplitStmts(
          userId,
          db,
          { id: c.id, posted_at: c.posted_at, amount_cents: c.amount_cents },
          rowSplits,
          transferCat.id,
        );
      };
      const reassignStmts = await Promise.all(
        pairs.flatMap((p) => [p.a, p.b]).map((id) => reassign(id)),
      );
      await db.batch([
        ...pairs.flatMap((p) => linkTransferStmts(userId, db, p.a, p.b)),
        ...reassignStmts.flat(),
      ]);
      transfersLinked = pairs.length;
    }
  } catch (e) {
    errors.push({ message: `Transfer detection: ${message(e)}` });
  }

  try {
    const idle = rowsInserted + rowsUpdated + transfersLinked === 0 && errors.length === 0;
    const startOfDay = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const skip =
      opts.skipRecurringWhenIdle === true &&
      idle &&
      (await hadSyncRunSince(userId, db, startOfDay, runId));
    if (!skip) await refreshRecurring(db, userId, today);
  } catch (e) {
    errors.push({ message: `Recurring detection: ${message(e)}` });
  }

  return finish();
}
