import type { PushSettings } from '../schemas/entities';

/**
 * What a push notification would say right now (SPEC §8.2). Pure. Each notice has a stable
 * key, so one already sent is never sent again; the caller records the keys it sends.
 */
export interface Notice {
  key: string;
  title: string;
  body: string;
  /** Where a tap opens. */
  url: string;
}

export interface NoticeInputs {
  series: readonly {
    id: string;
    name: string;
    status: string;
    expectedAmountCents: number;
    nextExpectedDate: string | null;
    previousAmountCents: number | null;
    priceChangedOn: string | null;
    doubleChargedOn: string | null;
  }[];
  flags: readonly {
    id: string;
    name: string;
    amountCents: number;
    flag: 'duplicate' | 'unusual' | 'first_time';
  }[];
  /** The latest sync's trouble, keyed so the same trouble is told once. */
  bankTrouble: { key: string; message: string } | null;
  /** Only on the recap's run. */
  recap: { weekOf: string; spentCents: number; toReview: number } | null;
  /** Surplus's projected lowest point when it is under zero, else null. */
  surplusNegative: { shortfallCents: number; date: string } | null;
  /** How many wait for review today; null when not looked up. */
  review: { day: string; count: number } | null;
}

/** One standing key: told once per dip, and cleared by the caller when Surplus recovers. */
export const SURPLUS_NEGATIVE_KEY = 'surplus:negative';

/** At most this many in one run; the rest are marked sent and wait in the app. */
export const MAX_NOTICES_PER_RUN = 5;

export const dollars = (cents: number): string => {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const c = abs % 100;
  return `$${whole}.${String(c).padStart(2, '0')}`;
};

const FLAG_TITLE = {
  duplicate: 'Possible duplicate',
  unusual: 'More than usual',
  first_time: 'Large first charge',
} as const;
const FLAG_PREF = { duplicate: 'duplicate', unusual: 'unusual', first_time: 'firstTime' } as const;

/** Every notice the owner's choices allow, newest kinds first, before de-duplication. */
export function notices(input: NoticeInputs, prefs: PushSettings): Notice[] {
  const out: Notice[] = [];
  if (input.bankTrouble && prefs.bankTrouble)
    out.push({
      key: `bank:${input.bankTrouble.key}`,
      title: 'Bank sync needs a look',
      body: input.bankTrouble.message,
      url: '/settings/sync',
    });
  for (const s of input.series) {
    if (prefs.missedBill && s.status === 'broken' && s.nextExpectedDate)
      out.push({
        key: `missed:${s.id}:${s.nextExpectedDate}`,
        title: `${s.name} hasn’t charged`,
        body: `It was due ${s.nextExpectedDate.slice(5).replace('-', '/')}.`,
        url: '/recurring',
      });
    if (prefs.priceUp && s.priceChangedOn && s.previousAmountCents !== null)
      out.push({
        key: `price:${s.id}:${s.priceChangedOn}`,
        title: `${s.name} went up`,
        body: `Now ${dollars(s.expectedAmountCents)}, was ${dollars(s.previousAmountCents)}.`,
        url: '/recurring',
      });
    if (prefs.doubleCharge && s.doubleChargedOn)
      out.push({
        key: `double:${s.id}:${s.doubleChargedOn}`,
        title: `${s.name} charged twice`,
        body: `Two charges of ${dollars(s.expectedAmountCents)} in one cycle.`,
        url: '/recurring',
      });
  }
  for (const f of input.flags) {
    if (!prefs[FLAG_PREF[f.flag]]) continue;
    out.push({
      key: `flag:${f.id}`,
      title: FLAG_TITLE[f.flag],
      body: `${f.name}, ${dollars(f.amountCents)}`,
      url: `/transactions/${f.id}`,
    });
  }
  if (input.recap && prefs.recap) {
    const r = input.recap;
    out.push({
      key: `recap:${r.weekOf}`,
      title: 'Your week',
      body: [
        `${dollars(r.spentCents)} spent`,
        r.toReview > 0 ? `${r.toReview} to review` : 'Nothing to review',
      ].join(' · '),
      url: r.toReview > 0 ? '/review' : '/',
    });
  }
  if (input.surplusNegative && prefs.surplusNegative) {
    const d = input.surplusNegative;
    out.push({
      key: SURPLUS_NEGATIVE_KEY,
      title: 'Surplus is going negative',
      body: `${dollars(d.shortfallCents)} short around ${d.date.slice(5).replace('-', '/')}.`,
      url: '/cash',
    });
  }
  // Once a day at most, and only a count: never one per transaction.
  if (input.review && input.review.count > 0 && prefs.toReview)
    out.push({
      key: `review:${input.review.day}`,
      title: `${input.review.count} to review`,
      body: 'Transactions are waiting for a look.',
      url: '/review',
    });
  return out;
}

/** What to send now: not sent before, capped; `mark` is every new key, sent or not. */
export function toSend(
  all: readonly Notice[],
  sent: ReadonlySet<string>,
): {
  send: Notice[];
  mark: string[];
} {
  const fresh = all.filter((n) => !sent.has(n.key));
  return { send: fresh.slice(0, MAX_NOTICES_PER_RUN), mark: fresh.map((n) => n.key) };
}
