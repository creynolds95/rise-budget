import { merchantName } from '@rise/shared/categorize';
import {
  notices,
  SURPLUS_NEGATIVE_KEY,
  toSend,
  type Notice,
  type NoticeInputs,
} from '@rise/shared/recurring';
import { PUSH_DEFAULTS, type PushSettings } from '@rise/shared/schemas';
import {
  clearSentKey,
  deletePushSubscription,
  flaggedForReview,
  getUser,
  getVapid,
  listAccounts,
  listPushSubscriptions,
  listSeries,
  listSyncRuns,
  markSentStmts,
  reviewCount,
  saveVapid,
  sentKeys,
  weekSummary,
} from '../db';
import type { UserId } from '../db/util';
import { buildCashToPaydayProjection, cashAccountsOf } from './cashToPayday';
import { localToday } from './dates';
import { generateVapidKeys, sendPush, type VapidKeys } from './webpush';

/** Push notifications (SPEC §8.2): what's new since the last run, to every device signed up. */

/** The sender's keys, made on first use and kept for good. */
export async function vapidKeys(userId: UserId, db: D1Database): Promise<VapidKeys> {
  const have = await getVapid(userId, db);
  if (have) return have;
  await saveVapid(userId, db, await generateVapidKeys());
  return (await getVapid(userId, db)) as VapidKeys;
}

const shiftDay = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

type PushUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/** Surplus's lowest point when it is under zero; null when fine. Only worked out when wanted. */
async function surplusShortfall(
  userId: UserId,
  db: D1Database,
  user: PushUser,
  today: string,
): Promise<{ shortfallCents: number; date: string } | null> {
  const accounts = await listAccounts(userId, db);
  const { cushionCents, dismissedPayMerchants } = user.settings;
  const start = cashAccountsOf(user.settings, accounts).reduce((sum, a) => sum + a.balanceCents, 0);
  const p = await buildCashToPaydayProjection(
    db,
    userId,
    today,
    start,
    cushionCents,
    dismissedPayMerchants.map((d) => d.merchant),
  );
  return p.freeToMoveCents < 0
    ? { shortfallCents: -p.freeToMoveCents, date: p.lowestPoint.date }
    : null;
}

async function gather(
  userId: UserId,
  db: D1Database,
  user: PushUser,
  today: string,
  prefs: PushSettings,
  runId?: string,
): Promise<NoticeInputs & { surplusChecked: boolean }> {
  const [series, flags, runs] = await Promise.all([
    listSeries(userId, db),
    flaggedForReview(userId, db),
    listSyncRuns(userId, db, 1),
  ]);
  const last = runs[0];
  const errors = last?.error_json ? (JSON.parse(last.error_json) as { message: string }[]) : [];
  const trouble =
    last && (last.status === 'failed' || errors.length > 0)
      ? (errors[0]?.message ?? 'The last sync failed.').slice(0, 160)
      : null;
  // The recap goes out on Sunday, over the seven days before it.
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  const week = sunday
    ? await weekSummary(userId, db, shiftDay(today, -7), shiftDay(today, -1))
    : null;
  const surplusChecked = prefs.surplusNegative;
  const [surplusNegative, toReview] = await Promise.all([
    surplusChecked ? surplusShortfall(userId, db, user, today) : null,
    prefs.toReview ? reviewCount(userId, db) : 0,
  ]);
  return {
    surplusChecked,
    surplusNegative,
    review: prefs.toReview && runId ? { runId, count: toReview } : null,
    series: series.map((s) => ({
      ...s,
      name: merchantName({ merchantNormalized: s.merchantNormalized }),
    })),
    flags,
    // Keyed on the message, so the same trouble is told once however many runs it lasts.
    bankTrouble: trouble ? { key: trouble, message: trouble } : null,
    recap: week ? { weekOf: today, ...week } : null,
  };
}

const ALL_ON = Object.fromEntries(Object.keys(PUSH_DEFAULTS).map((k) => [k, true])) as PushSettings;

/**
 * Mark everything that would be told today as told, without sending: a device signing up
 * hears about what happens next, not a backlog.
 */
export async function markCurrentAsSent(userId: UserId, db: D1Database, now: Date): Promise<void> {
  const user = await getUser(userId, db);
  if (!user) return;
  const all = notices(
    await gather(userId, db, user, localToday(user.timezone, now), ALL_ON),
    ALL_ON,
  );
  const sent = await sentKeys(
    userId,
    db,
    all.map((n) => n.key),
  );
  const { mark } = toSend(all, sent);
  if (mark.length > 0) await db.batch(markSentStmts(userId, db, mark));
}

/** Send one notice to every device; drop the ones the browser has unsubscribed. */
export async function deliver(
  userId: UserId,
  db: D1Database,
  notice: Pick<Notice, 'title' | 'body' | 'url'>,
  now: Date,
  badge?: number,
): Promise<number> {
  const [subs, keys, user] = await Promise.all([
    listPushSubscriptions(userId, db),
    vapidKeys(userId, db),
    getUser(userId, db),
  ]);
  if (!user) return 0;
  const payload = JSON.stringify(badge === undefined ? notice : { ...notice, badge });
  let sent = 0;
  for (const s of subs) {
    const outcome = await sendPush(keys, s, payload, `mailto:${user.email}`, now).catch(
      () => 'failed' as const,
    );
    if (outcome === 'gone') await deletePushSubscription(userId, db, s.endpoint);
    if (outcome === 'sent') sent++;
  }
  return sent;
}

/** After each cron sync: work out what's new, send up to five, remember all of it. */
export async function runPush(
  userId: UserId,
  db: D1Database,
  now: Date,
  newRunId?: string,
): Promise<{ sent: number; notices: number }> {
  const subs = await listPushSubscriptions(userId, db);
  if (subs.length === 0) return { sent: 0, notices: 0 };
  const user = await getUser(userId, db);
  if (!user) return { sent: 0, notices: 0 };
  // A kind hidden in the app (SPEC §8.1) never pushes either.
  const { push, alerts } = user.settings;
  const prefs: PushSettings = {
    ...push,
    priceUp: push.priceUp && alerts.priceUp,
    doubleCharge: push.doubleCharge && alerts.doubleCharge,
    duplicate: push.duplicate && alerts.duplicate,
    unusual: push.unusual && alerts.unusual,
    firstTime: push.firstTime && alerts.firstTime,
  };
  const inputs = await gather(userId, db, user, localToday(user.timezone, now), prefs, newRunId);
  // Recovered: the next dip is a new one and may be told again.
  if (inputs.surplusChecked && !inputs.surplusNegative)
    await clearSentKey(userId, db, SURPLUS_NEGATIVE_KEY);
  const all = notices(inputs, prefs);
  const { send, mark } = toSend(
    all,
    await sentKeys(
      userId,
      db,
      all.map((n) => n.key),
    ),
  );
  // Remembered before sending: a failure part-way never repeats a notice on the next run.
  if (mark.length > 0) await db.batch(markSentStmts(userId, db, mark));
  let sent = 0;
  for (const n of send) sent += await deliver(userId, db, n, now, inputs.review?.count);
  return { sent, notices: send.length };
}
