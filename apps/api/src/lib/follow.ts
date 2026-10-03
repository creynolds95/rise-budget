import { planFollowMoves } from '@rise/shared/follow';
import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import { FOLLOW_LOG_MAX, isLiabilityKind, UserSettings } from '@rise/shared/schemas';
import {
  getAccount,
  getUser,
  listAccounts,
  listPostedWindow,
  putSnapshotStmts,
  updateSettingsStmt,
  type UserId,
} from '../db';
import { localToday } from './dates';

/** How far back a sync looks for rows a rule hasn't followed yet. */
const WINDOW_DAYS = 45;
/** A row still in the window was followed on or after its own posting day, so its entry is
 *  never older than the window; one extra day of margin. Pruning by date, not count, is what
 *  keeps a followed row from being followed twice. */
const KEEP_DAYS = WINDOW_DAYS + 1;

/**
 * After a sync: a manual account that follows a transfer text (Apple Savings isn't connected,
 * so its side never arrives) gets each matching row's amount added to its balance, once. The
 * row itself, its category and the budget are never touched. Each application is logged so
 * Account → Undo can reverse it, and an undone row is never applied again. Reads nothing past
 * the user row unless a rule exists.
 */
export async function applyFollows(
  db: D1Database,
  userId: UserId,
  now: Date = new Date(),
): Promise<number> {
  const user = await getUser(userId, db);
  const follow = user?.settings.follow;
  if (!user || !follow || follow.rules.length === 0) return 0;
  const today = localToday(user.timezone, now);
  const accounts = await listAccounts(userId, db);
  const rules = follow.rules.filter((r) => {
    const a = accounts.find((x) => x.id === r.accountId);
    return a && !a.archivedAt && a.source === 'manual' && !isLiabilityKind(a.kind);
  });
  if (rules.length === 0) return 0;
  const earliest = rules.map((r) => r.since).sort()[0] as string;
  const floor = dateFromDayNumber(dayNumber(today) - WINDOW_DAYS);
  const rows = await listPostedWindow(userId, db, earliest > floor ? earliest : floor, today);
  const keepFrom = dateFromDayNumber(dayNumber(today) - KEEP_DAYS);
  const kept = follow.log.filter((e) => e.asOf >= keepFrom);
  const seen = new Set(kept.map((e) => e.txnId));
  // Never grow the log past its cap: what doesn't fit waits for a later sync, unfollowed.
  const moves = planFollowMoves(
    rules,
    rows.filter((r) => !seen.has(r.id)),
  ).slice(0, Math.max(0, FOLLOW_LOG_MAX - kept.length));
  if (moves.length === 0) return 0;
  const delta = new Map<string, number>();
  for (const m of moves) delta.set(m.accountId, (delta.get(m.accountId) ?? 0) + m.deltaCents);
  const log = [
    ...kept,
    ...moves.map((m) => ({
      txnId: m.txnId,
      accountId: m.accountId,
      deltaCents: m.deltaCents,
      asOf: today,
      undone: false,
    })),
  ];
  await db.batch([
    ...[...delta].flatMap(([accountId, d]) => {
      const a = accounts.find((x) => x.id === accountId);
      return a
        ? putSnapshotStmts(userId, db, accountId, {
            asOf: today,
            balanceCents: a.balanceCents + d,
            source: 'manual',
          })
        : [];
    }),
    updateSettingsStmt(
      userId,
      db,
      UserSettings.parse({ ...user.settings, follow: { ...follow, log } }),
    ),
  ]);
  return moves.length;
}

/** Reverses one logged application: the balance goes back, and the row is never followed again. */
export async function undoFollow(
  db: D1Database,
  userId: UserId,
  accountId: string,
  txnId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const user = await getUser(userId, db);
  const account = await getAccount(userId, db, accountId);
  const entry = user?.settings.follow.log.find(
    (e) => e.txnId === txnId && e.accountId === accountId && !e.undone,
  );
  if (!user || !account || account.source !== 'manual' || !entry) return false;
  const follow = user.settings.follow;
  const log = follow.log.map((e) => (e === entry ? { ...e, undone: true } : e));
  await db.batch([
    ...putSnapshotStmts(userId, db, accountId, {
      asOf: [entry.asOf, localToday(user.timezone, now)].sort().pop() as string,
      balanceCents: account.balanceCents - entry.deltaCents,
      source: 'manual',
    }),
    updateSettingsStmt(
      userId,
      db,
      UserSettings.parse({ ...user.settings, follow: { ...follow, log } }),
    ),
  ]);
  return true;
}
