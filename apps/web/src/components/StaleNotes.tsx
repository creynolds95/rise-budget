import { daysBetween, localToday, shortDate } from '../lib/dates';
import type { AccountWithStaleness } from '../lib/types';

/**
 * §8 stale state, per account against its own cadence (SPEC §2.7): names the account and
 * the gap. Never an estimate of the missing spend.
 */
export function staleText(a: AccountWithStaleness, today: string, tz?: string): string | null {
  if (!a.staleness.stale) return null;
  if (a.staleness.reason === 'never_synced') return `${a.name} hasn't synced yet.`;
  const last = localToday(tz, new Date(a.staleness.lastSyncedAtMs));
  const gap = daysBetween(last, today);
  return `${a.name} last synced ${shortDate(last)} — ${gap} ${gap === 1 ? 'day' : 'days'} not yet counted.`;
}

export function StaleNotes({
  accounts,
  today,
  tz,
}: {
  accounts: AccountWithStaleness[];
  today: string;
  tz?: string | undefined;
}) {
  const notes = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => staleText(a, today, tz))
    .filter((t): t is string => t !== null);
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Accounts not yet up to date">
      {notes.map((n) => (
        <li key={n} className="flex items-baseline gap-2 type-caption text-gold-text">
          <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-gold" />
          {n}
        </li>
      ))}
    </ul>
  );
}
