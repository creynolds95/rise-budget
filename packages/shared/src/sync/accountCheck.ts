import { MIN_STALE_HOURS } from '../budget/pace';

const HOUR_MS = 3_600_000;

/** One entry of SimpleFIN's structured `errlist` (protocol 1.0.7+). Every field but `msg` is optional. */
export interface SimpleFinErr {
  code?: string | undefined;
  msg: string;
  conn_id?: string | undefined;
  account_id?: string | undefined;
}

export interface AccountCheck {
  /** Rise ids of known accounts this response left out. Ids, not names: the run log keeps none. */
  missing: string[];
  /** Rise ids of known accounts that came back with a balance older than the staleness floor. */
  stale: { id: string; balanceDate: string }[];
  /** SimpleFIN's own errors, each attributed to an account when it named one. */
  errors: { account?: string; message: string }[];
}

/**
 * Which accounts a sync response left short. SimpleFIN's plain `errors` strings ("Failed to
 * get complete transaction set") never say which account, so name it from what we can
 * observe instead: accounts missing from the response, and accounts whose balance is old.
 * Pure: no I/O, and it never changes a run's status.
 */
export function checkAccounts(input: {
  known: { id: string; sourceAccountId: string; name: string }[];
  returned: { id: string; name: string; balanceDateMs: number }[];
  errors: string[];
  errlist: SimpleFinErr[];
  nowMs: number;
}): AccountCheck {
  const sent = new Set(input.returned.map((a) => a.id));
  const nameOf = new Map(input.known.map((a) => [a.sourceAccountId, a.name]));
  for (const a of input.returned) nameOf.set(a.id, a.name);

  const missing = input.known.filter((a) => !sent.has(a.sourceAccountId)).map((a) => a.id);
  const riseId = new Map(input.known.map((a) => [a.sourceAccountId, a.id]));
  const floor = input.nowMs - MIN_STALE_HOURS * HOUR_MS;
  const stale = input.returned.flatMap((a) => {
    const id = riseId.get(a.id);
    return id && a.balanceDateMs > 0 && a.balanceDateMs < floor
      ? [{ id, balanceDate: new Date(a.balanceDateMs).toISOString() }]
      : [];
  });

  const structured = input.errlist.map((e) => {
    const account = e.account_id ? nameOf.get(e.account_id) : undefined;
    return account ? { account, message: e.msg } : { message: e.msg };
  });
  // The plain strings usually repeat the structured ones; keep only the extras.
  const seen = new Set(input.errlist.map((e) => e.msg));
  const plain = input.errors.filter((m) => !seen.has(m)).map((message) => ({ message }));
  return { missing, stale, errors: [...structured, ...plain] };
}
