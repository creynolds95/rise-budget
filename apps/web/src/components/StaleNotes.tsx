import { useState } from 'react';
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

/**
 * Loans are a known slow feed (servicers rarely sync), so their staleness is shown on the
 * account itself as a reminder to update it, never in a summary list.
 */
export const quietWhenStale = (a: { kind: string }) => a.kind === 'loan';

/** Institutions whose every synced account is quiet when stale — their connection noise too. */
export function quietInstitutions(
  accounts: {
    kind: string;
    source: string;
    institutionName: string | null;
    archivedAt: string | null;
  }[],
): string[] {
  const synced = accounts.filter((a) => a.source === 'simplefin' && !a.archivedAt);
  const names = new Set(synced.flatMap((a) => (a.institutionName ? [a.institutionName] : [])));
  return [...names].filter((n) =>
    synced.filter((a) => a.institutionName === n).every(quietWhenStale),
  );
}

const DISMISSED_KEY = 'rise.dismissedStaleNotes';

/** Dismissals are keyed by account and the last-synced time they were made at. */
export const staleKey = (a: AccountWithStaleness): string =>
  `${a.id}@${a.staleness.stale && a.staleness.reason === 'overdue' ? a.staleness.lastSyncedAtMs : 'never'}`;

function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * `dismissible` (the Dashboard) hides an account's note on this device until that account's
 * next sync moves its last-synced time; a later stale spell shows again.
 */
export function StaleNotes({
  accounts,
  today,
  tz,
  dismissible,
}: {
  accounts: AccountWithStaleness[];
  today: string;
  tz?: string | undefined;
  dismissible?: boolean;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const notes = accounts
    .filter((a) => !a.archivedAt && !quietWhenStale(a))
    .filter((a) => !dismissible || !dismissed.includes(staleKey(a)))
    .map((a) => ({ key: staleKey(a), text: staleText(a, today, tz) }))
    .filter((n): n is { key: string; text: string } => n.text !== null);
  if (notes.length === 0) return null;
  const dismiss = (key: string) => {
    // Keys for syncs that have since moved on are dead weight; the list stays short.
    const next = [...dismissed, key].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: hidden until reload */
    }
  };
  return (
    <ul className="flex flex-col gap-1" aria-label="Accounts not yet up to date">
      {notes.map((n) => (
        <li key={n.key} className="flex items-start justify-between gap-2">
          <span className="flex items-baseline gap-2 type-caption text-gold-text">
            <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-gold" />
            {n.text}
          </span>
          {dismissible && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(n.key)}
              className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center text-ink-muted"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
