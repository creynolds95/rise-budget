import type { UsageStatus } from '@rise/shared/schemas';
import { BACKUP_LATE_DAYS, usageNote } from '../components/HealthNotes';
import { quietInstitutions, quietWhenStale, staleText } from '../components/StaleNotes';
import { daysBetween, localToday, shortDate } from './dates';
import type { AccountWithStaleness, SyncStatus } from './types';

/**
 * Settings → Health: every background job and connection in one list, each in plain words
 * with where to fix it. Built only from reads the app already makes (no queries of its own).
 * `ok` is null while its data is still loading.
 */
export interface HealthCheck {
  key: 'app' | 'banks' | 'accounts' | 'backup' | 'database';
  title: string;
  ok: boolean | null;
  text: string;
  /** What to do, for a check that isn't ok. */
  fix?: string;
  to?: string;
}

export interface HealthInput {
  sync: SyncStatus | undefined;
  accounts: AccountWithStaleness[] | undefined;
  backups: { latest: { date: string } | null } | undefined;
  usage: UsageStatus | undefined;
  /** null while the latest deployed build is unknown. */
  appStale: boolean | null;
  today: string;
  tz?: string | undefined;
}

const LOADING = 'Checking…';

export function healthChecks(h: HealthInput): HealthCheck[] {
  return [appCheck(h), banksCheck(h), accountsCheck(h), backupCheck(h), databaseCheck(h)];
}

function appCheck({ appStale }: HealthInput): HealthCheck {
  const title = 'App version';
  if (appStale === null) return { key: 'app', title, ok: null, text: LOADING };
  return appStale
    ? {
        key: 'app',
        title,
        ok: false,
        text: 'A newer version is deployed than the one open here.',
        fix: 'Tap Update, or close and reopen the app.',
      }
    : { key: 'app', title, ok: true, text: 'Up to date.' };
}

function banksCheck({ sync, accounts, tz }: HealthInput): HealthCheck {
  const title = 'Bank connection';
  const to = '/settings/sync';
  if (!sync) return { key: 'banks', title, ok: null, text: LOADING };
  if (sync.mode === 'off') {
    return {
      key: 'banks',
      title,
      ok: false,
      text: 'SimpleFIN isn’t connected, so nothing syncs.',
      fix: 'Claim a SimpleFIN setup token (docs/SETUP.md, step 6).',
      to,
    };
  }
  const last = sync.runs[0];
  if (!last) return { key: 'banks', title, ok: true, text: 'Connected. No sync has run yet.', to };
  if (last.status === 'failed') {
    const why = last.errors[0]?.message;
    return {
      key: 'banks',
      title,
      ok: false,
      text: `The last sync failed${why ? `: ${why}` : '.'}`,
      fix: 'Try Sync now. If it keeps failing, check SimpleFIN Bridge.',
      to,
    };
  }
  // SimpleFIN's own connection problems ("… may need attention") name no Rise account. A bank
  // the person already knows is flaky (every account there a loan) stays quiet, as on Dashboard.
  const quiet = quietInstitutions(accounts ?? []);
  const attention = last.errors.filter(
    (e) => !e.account && !quiet.some((name) => e.message.includes(name)),
  );
  if (attention.length > 0) {
    return {
      key: 'banks',
      title,
      ok: false,
      text: attention.map((e) => e.message).join(' '),
      fix: 'Sign in to that bank again inside SimpleFIN Bridge (not in Rise).',
      to,
    };
  }
  const when = last.finishedAt ?? last.startedAt;
  return {
    key: 'banks',
    title,
    ok: true,
    text: `Last synced ${shortDate(localToday(tz, new Date(when)))}.`,
    to,
  };
}

function accountsCheck({ accounts, today, tz }: HealthInput): HealthCheck {
  const title = 'Accounts';
  if (!accounts) return { key: 'accounts', title, ok: null, text: LOADING };
  const live = accounts.filter((a) => !a.archivedAt);
  if (live.length === 0) {
    return {
      key: 'accounts',
      title,
      ok: false,
      text: 'No accounts yet.',
      fix: 'Sync your banks, or add an account by hand.',
      to: '/accounts',
    };
  }
  const stale = live
    .filter((a) => !quietWhenStale(a))
    .flatMap((a) => {
      const t = staleText(a, today, tz);
      return t ? [t] : [];
    });
  return stale.length > 0
    ? {
        key: 'accounts',
        title,
        ok: false,
        text: stale.join(' '),
        fix: 'Usually the bank hasn’t reported yet; SimpleFIN checks about once a day.',
        to: '/accounts',
      }
    : { key: 'accounts', title, ok: true, text: `All ${live.length} current.`, to: '/accounts' };
}

function backupCheck({ backups, today }: HealthInput): HealthCheck {
  const title = 'Nightly backup';
  const to = '/settings/data';
  if (!backups) return { key: 'backup', title, ok: null, text: LOADING };
  const latest = backups.latest?.date;
  if (!latest) {
    return {
      key: 'backup',
      title,
      ok: false,
      text: 'No backup has run yet.',
      fix: 'Backups run from the backup GitHub workflow; it needs the repo secrets set.',
      to,
    };
  }
  return daysBetween(latest, today) >= BACKUP_LATE_DAYS
    ? {
        key: 'backup',
        title,
        ok: false,
        text: `Last backup was ${shortDate(latest)}.`,
        fix: 'Check the backup workflow’s latest run on GitHub.',
        to,
      }
    : { key: 'backup', title, ok: true, text: `Last backup ${shortDate(latest)}.`, to };
}

function databaseCheck({ usage }: HealthInput): HealthCheck {
  const title = 'Database use';
  const to = '/settings/data';
  if (!usage) return { key: 'database', title, ok: null, text: LOADING };
  const heavy = usageNote(usage);
  return heavy
    ? {
        key: 'database',
        title,
        ok: false,
        text: heavy.text,
        fix: 'Rise may pause until the free allowance resets at midnight UTC.',
        to,
      }
    : { key: 'database', title, ok: true, text: 'Well within the free allowance.', to };
}

/** The one-line summary for the Settings index. */
export function healthSummary(checks: HealthCheck[]): string | undefined {
  if (checks.some((c) => c.ok === null)) return undefined;
  const bad = checks.filter((c) => c.ok === false).length;
  return bad === 0 ? 'All good' : `${bad} ${bad === 1 ? 'needs' : 'need'} a look`;
}
