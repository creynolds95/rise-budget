import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../components/primitives/Button';
import { Chevron } from '../components/primitives/Rows';
import { healthChecks, type HealthCheck } from '../lib/health';
import {
  useAccounts,
  useBackupStatus,
  useMe,
  useSyncStatus,
  useToday,
  useUsage,
} from '../lib/queries';
import { transitionClick } from '../lib/transition';
import { isStale, RUNNING, updateApp, useLatestBuild } from '../lib/version';

/** Every check, from reads the app already makes: Health adds no queries of its own. */
export function useHealthChecks(): HealthCheck[] {
  const latest = useLatestBuild();
  const me = useMe().data;
  return healthChecks({
    sync: useSyncStatus().data,
    accounts: useAccounts().data,
    backups: useBackupStatus().data,
    usage: useUsage().data,
    appStale: latest === null ? null : isStale(RUNNING, latest),
    today: useToday(),
    tz: me?.timezone,
  });
}

const DOT = {
  ok: 'bg-sage-600',
  bad: 'bg-clay',
  loading: 'bg-hairline',
} as const;

function CheckRow({ c }: { c: HealthCheck }) {
  const navigate = useNavigate();
  const [updating, setUpdating] = useState(false);
  const state = c.ok === null ? 'loading' : c.ok ? 'ok' : 'bad';
  const body = (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {c.title}
          <span className="sr-only">
            : {state === 'ok' ? 'fine' : state === 'bad' ? 'needs a look' : 'checking'}
          </span>
        </span>
        <span className={`mt-0.5 block ${c.ok === false ? 'text-clay-text' : 'text-ink-muted'}`}>
          {c.text}
        </span>
        {c.ok === false && c.fix && (
          <span className="mt-1 block type-caption text-ink-muted">{c.fix}</span>
        )}
      </span>
    </span>
  );
  if (c.key === 'app' && c.ok === false) {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        {body}
        <Button
          className="shrink-0"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            void updateApp();
          }}
        >
          {updating ? 'Updating…' : 'Update'}
        </Button>
      </li>
    );
  }
  if (!c.to) return <li className="flex items-center px-4 py-3">{body}</li>;
  const to = c.to;
  return (
    <li>
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="flex items-center gap-3 px-4 py-3 active:bg-sage-100"
      >
        {body}
        <Chevron />
      </Link>
    </li>
  );
}

/** Settings → Health: is everything running, and if not, what to do about it. */
export function HealthSection() {
  const checks = useHealthChecks();
  return (
    <ul
      aria-label="Health checks"
      className="mt-2 divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft"
    >
      {checks.map((c) => (
        <CheckRow key={c.key} c={c} />
      ))}
    </ul>
  );
}
