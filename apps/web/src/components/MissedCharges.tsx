import type { RecurringSeries } from '@rise/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { shortDate } from '../lib/dates';
import { merchantName } from '../lib/merchant';
import { useMe } from '../lib/queries';

/** "Jun 1", or "Jun 1, 2025" when it isn't this year. */
export function dueDate(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? shortDate(date)
    : `${shortDate(date)}, ${date.slice(0, 4)}`;
}

/** Missed charges still worth a clay note: broken, and not dismissed for that due date. */
export function useMissed(series: readonly RecurringSeries[] | undefined): RecurringSeries[] {
  const dismissed = useMe().data?.settings.dismissedMisses ?? [];
  return (series ?? []).filter(
    (s) =>
      s.status === 'broken' &&
      !dismissed.some((d) => d.seriesId === s.id && d.dueDate === s.nextExpectedDate),
  );
}

/** "It ended" archives a detected series; "Track again" un-archives it. */
export function useSetSeriesStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'ended' | 'active' }) =>
      api('PATCH', `/recurring/${encodeURIComponent(v.id)}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });
}

const action = 'min-h-11 px-2 type-caption font-semibold text-sage-700 disabled:opacity-40';

/** One missed charge, with Dismiss (this miss only) and It ended (stop watching). */
export function MissedRow({
  s,
  today,
  all,
}: {
  s: RecurringSeries;
  today: string;
  /** Every series, so dismissals of ones no longer missed can be dropped. */
  all: readonly RecurringSeries[];
}) {
  const qc = useQueryClient();
  const dismissed = useMe().data?.settings.dismissedMisses ?? [];
  const dismiss = useMutation({
    mutationFn: () => {
      const stillMissed = dismissed.filter((d) =>
        all.some(
          (x) => x.id === d.seriesId && x.status === 'broken' && x.nextExpectedDate === d.dueDate,
        ),
      );
      return api('PATCH', '/me/settings', {
        dismissedMisses: [...stillMissed, { seriesId: s.id, dueDate: s.nextExpectedDate ?? '' }],
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const setStatus = useSetSeriesStatus();
  const busy = dismiss.isPending || setStatus.isPending;
  return (
    <li className="flex min-h-12 items-center justify-between gap-2 border-b border-hairline py-2 last:border-b-0">
      <span className="text-clay">
        {merchantName(s)} hasn't charged since it was due {dueDate(s.nextExpectedDate ?? '', today)}
        .
      </span>
      <span className="-mr-2 flex shrink-0">
        <button type="button" className={action} disabled={busy} onClick={() => dismiss.mutate()}>
          Dismiss
        </button>
        {s.source === 'detected' && (
          <button
            type="button"
            className={action}
            disabled={busy}
            onClick={() => setStatus.mutate({ id: s.id, status: 'ended' })}
          >
            It ended
          </button>
        )}
      </span>
    </li>
  );
}
