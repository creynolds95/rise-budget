import { Link } from 'react-router';
import { daysBetween, shortDate } from '../lib/dates';
import type { SyncStatus } from '../lib/types';

/** A backup is late once a night has been missed (C6). */
export const BACKUP_LATE_DAYS = 2;

type Backups = { latest: { date: string; bytes: number } | null; count: number };

/**
 * The background jobs failing out of sight (C6): the last bank sync failed outright, or the
 * nightly backup hasn't landed. Each links to where it can be looked into.
 */
export function healthNotes(
  sync: SyncStatus | undefined,
  backups: Backups | undefined,
  today: string,
): { text: string; to: string }[] {
  const out: { text: string; to: string }[] = [];
  const last = sync?.runs[0];
  if (sync && sync.mode !== 'off' && last?.status === 'failed') {
    const why = last.errors[0]?.message;
    out.push({ text: `Bank sync failed${why ? `: ${why}` : '.'}`, to: '/settings/sync' });
  }
  if (backups) {
    const latest = backups.latest?.date;
    if (!latest) out.push({ text: 'No backup has run yet.', to: '/settings/data' });
    else if (daysBetween(latest, today) >= BACKUP_LATE_DAYS)
      out.push({ text: `Last backup was ${shortDate(latest)}.`, to: '/settings/data' });
  }
  return out;
}

export function HealthNotes(props: {
  sync: SyncStatus | undefined;
  backups: Backups | undefined;
  today: string;
}) {
  const notes = healthNotes(props.sync, props.backups, props.today);
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Background jobs needing attention">
      {notes.map((n) => (
        <li key={n.text}>
          <Link to={n.to} className="flex items-baseline gap-2 type-caption text-clay">
            <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-clay" />
            {n.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}
