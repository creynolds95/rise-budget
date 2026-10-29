import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import {
  amountOn,
  anyNearDue,
  BALANCE_GIVE_UP_DAYS,
  EARLY_MATCH_DAYS,
  handAddedArrival,
  learnLag,
  seenInBalance,
  within5Pct,
  type Cadence,
  type SeenInBalance,
} from '@rise/shared/recurring';
import {
  accountTxnsSince,
  changeOf,
  getUser,
  listAccounts,
  listManualRules,
  setBalanceSeenStmt,
  snapshotsSince,
  type CashTxnRow,
  type ManualRuleRow,
  type UserId,
} from '../db';
import { cashAccountsOf } from './cashToPayday';
import { localToday } from './dates';

/** Far enough back for a balance from before the oldest due date still weighed. */
const LOOKBACK_DAYS = 30;

export interface BalanceEvidence {
  /** Manual rules (by id) whose money the cash accounts' balance already shows. */
  seen: Map<string, SeenInBalance>;
  /** The cash accounts' rows over the lookback, newest-agnostic. */
  rows: CashTxnRow[];
}

/** What the cash accounts' balance shows of each manual rule (`shared/recurring/inBalance`). */
export async function loadBalanceEvidence(
  db: D1Database,
  userId: UserId,
  rules: readonly ManualRuleRow[],
  cashAccountIds: readonly string[],
  today: string,
): Promise<BalanceEvidence> {
  const shaped = rules.map((r) => ({
    id: r.id,
    dueOn: r.next_expected_date,
    amountCents: amountOn(r.expected_amount_cents, changeOf(r), r.next_expected_date),
    lagDays: r.balance_lag_days,
    seenDue: r.balance_seen_due,
  }));
  if (cashAccountIds.length === 0 || !anyNearDue(shaped, today))
    return { seen: new Map(), rows: [] };
  const from = dateFromDayNumber(dayNumber(today) - LOOKBACK_DAYS);
  const per = await Promise.all(
    cashAccountIds.map(async (id) => {
      const [snaps, rows] = await Promise.all([
        snapshotsSince(userId, db, id, from),
        accountTxnsSince(userId, db, id, from),
      ]);
      return { id, snaps, rows };
    }),
  );
  const seen = seenInBalance(
    new Map(per.map((p) => [p.id, p.snaps])),
    per.flatMap((p) =>
      p.rows.map((t) => ({
        accountId: p.id,
        postedAt: t.posted_at,
        amountCents: t.amount_cents,
        isPending: t.is_pending === 1,
      })),
    ),
    shaped,
    today,
  );
  return { seen: new Map(seen.map((s) => [s.id, s])), rows: per.flatMap((p) => p.rows) };
}

/**
 * The row that confirms a rule seen in the balance, if it has come. A tagged rule's own
 * merchant at about its amount; a hand-added one has no merchant, so the amount alone.
 */
function arrivalOf(r: ManualRuleRow, due: string, rows: readonly CashTxnRow[]) {
  const amountCents = amountOn(r.expected_amount_cents, changeOf(r), due);
  if (r.label != null)
    return handAddedArrival(
      { amountCents, dueOn: due },
      rows.map((t) => ({ ...t, postedAt: t.posted_at, amountCents: t.amount_cents })),
    );
  // A tagged rule moves on only once its charge posts: until then nothing has arrived.
  if (r.next_expected_date <= due) return null;
  const from = dateFromDayNumber(dayNumber(due) - EARLY_MATCH_DAYS[r.cadence as Cadence]);
  return (
    rows
      .filter(
        (t) =>
          t.merchant_normalized === r.merchant_normalized &&
          t.posted_at >= from &&
          within5Pct(t.amount_cents, amountCents),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? {
      created_at: null,
    }
  );
}

/**
 * After a sync: remember which schedules the balance newly shows, and when one's transaction
 * finally comes, learn how many days it trailed the balance. A schedule seen this long with no
 * row is let go (its alert has long been sent).
 */
export async function trackBalanceSeen(db: D1Database, userId: UserId, today: string) {
  const [user, accounts, rules] = await Promise.all([
    getUser(userId, db),
    listAccounts(userId, db),
    listManualRules(userId, db),
  ]);
  if (!user) return;
  const cashIds = cashAccountsOf(user.settings, accounts).map((a) => a.id);
  const { seen, rows } = await loadBalanceEvidence(db, userId, rules, cashIds, today);
  const stmts: D1PreparedStatement[] = [];
  for (const r of rules) {
    const live = seen.get(r.id);
    const lagDays = r.balance_lag_days;
    if (r.balance_seen_due && r.balance_seen_on) {
      const seenOn = r.balance_seen_on;
      const arrived = arrivalOf(r, r.balance_seen_due, rows);
      if (arrived) {
        const landed = arrived.created_at
          ? localToday(user.timezone, new Date(arrived.created_at))
          : today;
        const sample = dayNumber(landed) - dayNumber(seenOn);
        stmts.push(
          setBalanceSeenStmt(userId, db, r.id, {
            due: null,
            on: null,
            twice: false,
            lagDays: learnLag(lagDays, sample),
          }),
        );
      } else if (dayNumber(today) - dayNumber(seenOn) > BALANCE_GIVE_UP_DAYS) {
        stmts.push(
          setBalanceSeenStmt(userId, db, r.id, { due: null, on: null, twice: false, lagDays }),
        );
      } else if (live?.twice && r.balance_seen_twice === 0) {
        stmts.push(
          setBalanceSeenStmt(userId, db, r.id, {
            due: r.balance_seen_due,
            on: seenOn,
            twice: true,
            lagDays,
          }),
        );
      }
    } else if (live) {
      stmts.push(
        setBalanceSeenStmt(userId, db, r.id, {
          due: live.dueOn,
          on: today,
          twice: live.twice,
          lagDays,
        }),
      );
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
}

/** The first projected occurrence a seen rule already paid, so it is not counted again. */
export function paidAlready(
  r: Pick<ManualRuleRow, 'label'>,
  seen: SeenInBalance | undefined,
  first: { date: string } | undefined,
  today: string,
): boolean {
  if (!seen || !first) return false;
  if (first.date === seen.dueOn) return true;
  // A tagged bill past due is projected as owed today: that is the one the balance shows.
  return r.label == null && seen.dueOn < today && first.date === today;
}
