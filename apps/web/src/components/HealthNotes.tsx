import { useState } from 'react';
import { Link } from 'react-router';
import { daysBetween, shortDate } from '../lib/dates';
import type { UsageStatus } from '@rise/shared/schemas';
import type { SyncStatus } from '../lib/types';

/** A backup is late once a night has been missed (C6). */
export const BACKUP_LATE_DAYS = 2;

type Backups = { latest: { date: string; bytes: number } | null; count: number };

/**
 * Normal days use a few percent of the free database allowance. Well past that, something is
 * reading or writing far more than it should, and it should be seen hours before the cap.
 */
export const USAGE_WARN = 0.4;

export function usageNote(
  usage: UsageStatus | undefined,
  utcDay = new Date().toISOString().slice(0, 10), // the allowance resets at 00:00 UTC
) {
  const day = usage?.days.find((d) => d.day === utcDay);
  if (!usage || !day) return null;
  const share = Math.max(
    day.rowsRead / usage.limits.rowsRead,
    day.rowsWritten / usage.limits.rowsWritten,
  );
  if (share < USAGE_WARN) return null;
  const top = usage.routes[0]?.route;
  return {
    text: `Database use today is ${Math.round(share * 100)}% of the free limit${top ? `, mostly ${top}` : ''}.`,
    to: '/settings/data',
  };
}

/**
 * The background jobs failing out of sight (C6): the last bank sync failed outright or a bank
 * connection needs attention, or the nightly backup hasn't landed. Each links to where it can be looked into.
 */
export function healthNotes(
  sync: SyncStatus | undefined,
  backups: Backups | undefined,
  today: string,
  quiet: string[] = [],
  usage?: UsageStatus,
): { text: string; to: string }[] {
  const out: { text: string; to: string }[] = [];
  const heavy = usageNote(usage);
  if (heavy) out.push(heavy);
  const last = sync?.runs[0];
  if (sync && sync.mode !== 'off' && last?.status === 'failed') {
    const why = last.errors[0]?.message;
    out.push({ text: `Bank sync failed${why ? `: ${why}` : '.'}`, to: '/settings/sync' });
  } else if (sync && sync.mode !== 'off' && last?.status === 'partial') {
    // A bank connection SimpleFIN reports as needing attention names no Rise account, so no
    // per-account stale note would ever mention it.
    // …except one the person already knows is flaky (see quietInstitutions).
    const known = (m: string) => quiet.some((name) => m.includes(name));
    for (const e of last.errors.filter((e) => !e.account && !known(e.message))) {
      out.push({ text: e.message, to: '/settings/sync' });
    }
  }
  if (backups) {
    const latest = backups.latest?.date;
    if (!latest) out.push({ text: 'No backup has run yet.', to: '/settings/data' });
    else if (daysBetween(latest, today) >= BACKUP_LATE_DAYS)
      out.push({ text: `Last backup was ${shortDate(latest)}.`, to: '/settings/data' });
  }
  return out;
}

const DISMISSED_KEY = 'rise.dismissedHealthNotes';

function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * `dismissible` notes (the Dashboard) can be hidden by their text on this device, so a known
 * problem stops nagging; a different message shows again. The Accounts page lists them all.
 */
export function HealthNotes(props: {
  sync: SyncStatus | undefined;
  backups: Backups | undefined;
  today: string;
  quiet?: string[];
  usage?: UsageStatus | undefined;
  dismissible?: boolean;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const notes = healthNotes(
    props.sync,
    props.backups,
    props.today,
    props.quiet,
    props.usage,
  ).filter((n) => !props.dismissible || !dismissed.includes(n.text));
  const dismiss = (text: string) => {
    const next = [...dismissed, text];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: hidden until reload */
    }
  };
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Background jobs needing attention">
      {notes.map((n) => (
        <li key={n.text} className="flex items-start justify-between gap-2">
          <Link to={n.to} className="flex items-baseline gap-2 type-caption text-clay">
            <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-clay" />
            {n.text}
          </Link>
          {props.dismissible && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(n.text)}
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
