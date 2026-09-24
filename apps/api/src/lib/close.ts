import {
  closeReadiness,
  hasEnded,
  nextPeriod,
  type CloseReadiness,
  type PeriodCloseInput,
} from '@rise/shared/budget';
import { getUser, listAccounts } from '../db';
import type { Env } from '../env';
import { localToday } from './dates';
import { loadPeriodView } from './period-view';

/** A period's stored inputs, shaped for the engine's close. Expense categories only. */
export async function loadCloseInput(
  env: Env,
  userId: string,
  periodId: string,
): Promise<PeriodCloseInput> {
  const [{ period, view }, user] = await Promise.all([
    loadPeriodView(env, userId, periodId),
    getUser(userId, env.DB),
  ]);
  return {
    periodId,
    status: period.status,
    expectedIncomeCents: period.expectedIncomeCents,
    actualIncomeCents: view.actualIncomeCents,
    rollIncomeVariance: user?.settings.rollIncomeVariance ?? true,
    categories: view.categories
      .filter((c) => c.groupKind === 'expense')
      .map((c) => ({
        categoryId: c.categoryId,
        rolloverPolicy: c.rolloverPolicy,
        carriedInCents: c.carriedInCents,
        plannedCents: c.plannedCents,
        spentCents: c.spentCents,
      })),
  };
}

export interface CloseStatus {
  ended: boolean;
  readiness: CloseReadiness;
}

/** What the close control shows: whether the month is over and what it's waiting on (edge 10c). */
export async function loadCloseStatus(
  env: Env,
  userId: string,
  periodId: string,
): Promise<CloseStatus> {
  const [user, accounts] = await Promise.all([
    getUser(userId, env.DB),
    listAccounts(userId, env.DB),
  ]);
  const tz = user?.timezone ?? 'America/Chicago';
  return {
    ended: hasEnded(periodId, localToday(tz)),
    readiness: closeReadiness(
      periodId,
      accounts.map((a) => ({
        accountId: a.id,
        name: a.name,
        source: a.source,
        includeInBudget: a.includeInBudget,
        lastSyncedDate: a.lastSyncedAt ? localToday(tz, new Date(a.lastSyncedAt)) : null,
      })),
    ),
  };
}

export { nextPeriod };
