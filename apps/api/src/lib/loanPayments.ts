import { EARLY_DAYS, dueDateIn, isDue, planAutoApply, type AutoLoan } from '@rise/shared/debt';
import { dateFromDayNumber, dayNumber } from '@rise/shared/networth';
import { UserSettings } from '@rise/shared/schemas';
import {
  getUser,
  listAccounts,
  listOutflows,
  putSnapshotStmts,
  updateSettingsStmt,
  type UserId,
} from '../db';
import { localToday } from './dates';

/**
 * After a sync: for each manual loan whose payment is due, look for the real debit in
 * checking and, only on an exact match, write the balance and mark the month done in one
 * batch (a crash can't leave one without the other). The Debt page shows what was applied
 * and can undo it. Returns how many loans were applied. Reads nothing past the user row and
 * accounts unless a payment is actually due.
 */
export async function applyLoanPayments(
  db: D1Database,
  userId: UserId,
  now: Date = new Date(),
): Promise<number> {
  const user = await getUser(userId, db);
  const plan = user?.settings.debt;
  if (!user || !plan || !plan.autoApply || plan.loans.length === 0) return 0;
  const today = localToday(user.timezone, now);
  const accounts = await listAccounts(userId, db);
  const loans: AutoLoan[] = plan.loans.flatMap((l) => {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a || a.archivedAt || a.source !== 'manual') return [];
    return [{ ...l, owedCents: Math.max(0, -a.balanceCents) }];
  });
  const period = today.slice(0, 7);
  const due = loans.filter((l) => isDue(l, today));
  if (due.length === 0) return 0;
  const earliest = due.map((l) => dueDateIn(period, l.dueDay)).sort()[0] as string;
  const from = dateFromDayNumber(dayNumber(earliest) - EARLY_DAYS);
  const outflows = await listOutflows(userId, db, from, today);
  const applied = planAutoApply(loans, outflows, today);
  if (applied.length === 0) return 0;
  const byAccount = new Map(applied.map((a) => [a.accountId, a]));
  const debt = {
    ...plan,
    loans: plan.loans.map((l) =>
      byAccount.has(l.accountId) ? { ...l, appliedThrough: period } : l,
    ),
    lastAuto: {
      period,
      loans: applied.map((a) => ({
        accountId: a.accountId,
        beforeCents: a.beforeCents,
        afterCents: a.afterCents,
        asOf: a.asOf,
        prevApplied: plan.loans.find((l) => l.accountId === a.accountId)?.appliedThrough ?? period,
      })),
    },
  };
  await db.batch([
    ...applied.flatMap((a) =>
      putSnapshotStmts(userId, db, a.accountId, {
        asOf: a.asOf,
        balanceCents: -a.afterCents,
        source: 'manual',
      }),
    ),
    updateSettingsStmt(userId, db, UserSettings.parse({ ...user.settings, debt })),
  ]);
  return applied.length;
}
