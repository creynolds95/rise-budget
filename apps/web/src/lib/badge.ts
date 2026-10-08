import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { get } from './api';

type BadgeNav = {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Show the number waiting for review on the home-screen icon; nothing waiting clears it. */
export function setBadge(count: number, nav: BadgeNav = navigator): void {
  const n = Math.max(0, Math.floor(count));
  const done = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.();
  done?.catch(() => {});
}

/** Keeps the icon badge in step with the review count (the Dashboard's own query). */
export function useAppBadge(): void {
  const q = useQuery({
    queryKey: ['queue-count'],
    queryFn: () => get<{ count: number }>('/review/count'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const count = q.data?.count;
  useEffect(() => {
    if (count !== undefined) setBadge(count);
  }, [count]);
}
