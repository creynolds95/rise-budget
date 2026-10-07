import { Loading } from '../components/Pending';
import { DetailPage } from '../components/detail/DetailPage';
import { dueDate, MissedRow, useMissed, useSetSeriesStatus } from '../components/MissedCharges';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { shortDate } from '../lib/dates';
import { merchantName } from '../lib/merchant';
import { useCategories, useRecurring, useToday } from '../lib/queries';

/** Every active recurring charge, soonest first. Pushed from the Dashboard menu. */
export function Recurring() {
  const today = useToday();
  const recurring = useRecurring();
  const categories = useCategories();
  const back = { label: 'Dashboard', to: '/' };
  const broken = useMissed(recurring.data);
  const setStatus = useSetSeriesStatus();

  if (recurring.isPending) {
    return (
      <DetailPage
        header={{ back, title: 'Recurring' }}
        facts={
          <Loading>
            <Skeleton className="my-4 h-24 w-full" />
          </Loading>
        }
      />
    );
  }

  const all = recurring.data ?? [];
  const rows = all
    .filter((s) => (s.status === 'active' || s.status === 'broken') && s.expectedAmountCents > 0)
    .sort((a, b) => (a.nextExpectedDate ?? '9999').localeCompare(b.nextExpectedDate ?? '9999'));
  // Stopped on their own (two cycles missed), or ended by the user. Quiet, never clay.
  const stopped = all.filter((s) => s.status === 'lapsed' || s.status === 'ended');

  return (
    <DetailPage
      header={{ back, title: 'Recurring' }}
      facts={
        rows.length === 0 && stopped.length === 0 ? (
          <p className="py-4 text-ink-muted">Nothing recurring yet.</p>
        ) : (
          <ul>
            {rows.map((s) => (
              <li
                key={s.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-3 last:border-b-0"
              >
                <span>
                  {merchantName(s)}
                  <span className="block type-caption text-ink-faint">
                    {s.nextExpectedDate && s.nextExpectedDate < today ? 'Due' : 'Expected'}{' '}
                    {shortDate(s.nextExpectedDate ?? '')}
                    {s.categoryId
                      ? ` · ${categories.data?.find((c) => c.id === s.categoryId)?.name ?? ''}`
                      : ''}
                  </span>
                </span>
                <MoneyText cents={s.expectedAmountCents} />
              </li>
            ))}
            {broken.map((s) => (
              <MissedRow key={`b-${s.id}`} s={s} today={today} all={all} />
            ))}
            {stopped.length > 0 && (
              <li className="pt-6 pb-1 type-caption font-semibold text-ink-muted">Stopped</li>
            )}
            {stopped.map((s) => (
              <li
                key={`s-${s.id}`}
                className="flex min-h-12 items-center justify-between gap-2 border-b border-hairline py-2 text-ink-muted last:border-b-0"
              >
                <span>
                  {merchantName(s)}
                  <span className="block type-caption text-ink-faint">
                    {s.status === 'ended'
                      ? 'Ended by you'
                      : `Missed since ${dueDate(s.nextExpectedDate ?? '', today)}`}
                  </span>
                </span>
                {s.source === 'detected' && (
                  <button
                    type="button"
                    className="-mr-2 min-h-11 shrink-0 px-2 type-caption font-semibold text-sage-700 disabled:opacity-40"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({
                        id: s.id,
                        status: s.status === 'ended' ? 'active' : 'ended',
                      })
                    }
                  >
                    {s.status === 'ended' ? 'Track again' : 'It ended'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
