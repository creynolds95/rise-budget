import { mulDiv, sumCents, type Cents } from '../budget/money';
import { parseIsoDate, type IsoDate } from '../budget/period';

/**
 * Net worth from balance snapshots (SPEC §5.1, §5.3). Pure.
 *
 * Between two snapshots a balance is linearly interpolated and flagged as such. After the
 * last snapshot it is held flat and flagged — it is not measured. Before an account's first
 * snapshot it contributes nothing (we know nothing about it yet).
 */

export interface Snapshot {
  asOf: IsoDate;
  balanceCents: Cents;
}

export type BalanceKind = 'measured' | 'interpolated' | 'held';

export interface BalancePoint {
  balanceCents: Cents;
  kind: BalanceKind;
}

/** Days since 1970-01-01 for a valid ISO date, in pure integer arithmetic. */
export function dayNumber(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  // Howard Hinnant's days_from_civil.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function dateFromDayNumber(n: number): IsoDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Balance of one account on `date`, or null before its first snapshot. */
export function balanceAt(snapshots: readonly Snapshot[], date: IsoDate): BalancePoint | null {
  const sorted = [...snapshots].sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  const d = dayNumber(date);
  let before: Snapshot | undefined;
  for (const s of sorted) {
    const sd = dayNumber(s.asOf);
    if (sd === d) return { balanceCents: s.balanceCents, kind: 'measured' };
    if (sd < d) {
      before = s;
      continue;
    }
    if (!before) return null;
    const b0 = dayNumber(before.asOf);
    const value =
      before.balanceCents + mulDiv(s.balanceCents - before.balanceCents, d - b0, sd - b0);
    return { balanceCents: value, kind: 'interpolated' };
  }
  return before ? { balanceCents: before.balanceCents, kind: 'held' } : null;
}

export interface NetWorthAccount {
  accountId: string;
  includeInNetWorth: boolean;
  snapshots: readonly Snapshot[];
}

export interface NetWorthPoint {
  date: IsoDate;
  netWorthCents: Cents;
  /** True when any contributing balance is interpolated or held — render dashed. */
  inferred: boolean;
}

/**
 * Daily series from `from` to `to` inclusive. Credit and loan balances are stored negative
 * (SPEC §1.1), so they reduce net worth by plain addition.
 */
export function netWorthSeries(
  accounts: readonly NetWorthAccount[],
  from: IsoDate,
  to: IsoDate,
): NetWorthPoint[] {
  const start = dayNumber(from);
  const end = dayNumber(to);
  const included = accounts.filter((a) => a.includeInNetWorth);
  const out: NetWorthPoint[] = [];
  for (let n = start; n <= end; n++) {
    const date = dateFromDayNumber(n);
    const points = included.map((a) => balanceAt(a.snapshots, date)).filter((p) => p !== null);
    out.push({
      date,
      netWorthCents: sumCents(points.map((p) => p.balanceCents)),
      inferred: points.some((p) => p.kind !== 'measured'),
    });
  }
  return out;
}
