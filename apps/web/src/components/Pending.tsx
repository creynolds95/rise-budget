import type { ReactNode } from 'react';
import { useMe } from '../lib/queries';
import { useOnline, useStuckQueries } from './OfflineBar';
import { DetailPage, type DetailPageProps } from './detail/DetailPage';
import { Skeleton } from './primitives/Skeleton';

/** Offline, and something on screen has never been loaded on this device. */
export function useOfflineGap(): boolean {
  const online = useOnline();
  const stuck = useStuckQueries();
  return !online && stuck > 0;
}

export function OfflineGap({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`type-body text-ink-muted ${compact ? 'py-3' : 'py-10 text-center'}`}>
      Not available offline
    </p>
  );
}

/**
 * A loading placeholder that gives up and says so once offline with nothing cached (C5).
 * A placeholder only renders while its own read has no data, so offline with any read
 * stuck, this one is among them.
 */
export function Loading({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return useOfflineGap() ? <OfflineGap compact={compact ?? false} /> : <>{children}</>;
}

/**
 * Whether the settings in hand are known to be current, so a missing plan really means
 * "not set up". A cached copy read offline, or one whose refresh failed, may predate a plan
 * made since — saying "Not set up" (and offering to set one up over it) would be a guess.
 */
export type SettingsState = 'current' | 'loading' | 'offline' | 'failed';

export function useSettingsState(): SettingsState {
  const me = useMe();
  const online = useOnline();
  if (!online) return 'offline';
  if (me.status === 'error') return me.isFetching ? 'loading' : 'failed';
  if (me.status === 'pending' || (me.isStale && me.isFetching)) return 'loading';
  return 'current';
}

/** A plan page whose plan is missing from settings that aren't known to be current. */
export function PlanUnknown({
  header,
  label,
  state,
}: {
  header: DetailPageProps['header'];
  label: string;
  state: Exclude<SettingsState, 'current'>;
}) {
  if (state === 'loading') {
    return <DetailPage header={header} shape={<Skeleton className="h-64 w-full" />} />;
  }
  return (
    <DetailPage
      header={header}
      identity={{
        label,
        hero: <span className="text-ink-muted">—</span>,
        context: state === 'offline' ? 'Not available offline' : "Couldn't load",
      }}
    />
  );
}
