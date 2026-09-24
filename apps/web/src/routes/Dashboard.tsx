import type { RecurringSeries } from '@rise/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { StaleNotes } from '../components/StaleNotes';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { get } from '../lib/api';
import { addMonths, monthName, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import {
  useAccounts,
  useCategories,
  useMe,
  usePeriod,
  useRecurring,
  useToday,
} from '../lib/queries';

/** "This month, answered" (T41). The on-pace answer first, then what needs attention. */
export function Dashboard() {
  const today = useToday();
  const month = today.slice(0, 7);
  const me = useMe().data;
  const period = usePeriod(month);
  const last = usePeriod(addMonths(month, -1));
  const accounts = useAccounts();
  const recurring = useRecurring();
  const categories = useCategories();
  const queue = useQuery({
    queryKey: ['queue-count'],
    queryFn: () => get<{ count: number }>('/review/queue'),
  });

  if (!period.data) {
    return (
      <div className="gutter mx-auto max-w-2xl pt-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-11 w-56" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-10 h-12 w-full" />
        <Skeleton className="mt-2 h-12 w-full" />
      </div>
    );
  }
  const p = period.data;
  const t = p.totals;
  const expectedByNow = p.categories.reduce((n, c) => n + (c.pace?.expectedSpentCents ?? 0), 0);
  const ahead = t.spentCents - expectedByNow;
  const upcoming = (recurring.data ?? []).filter(
    (s: RecurringSeries) =>
      s.status !== 'ended' &&
      s.nextExpectedDate &&
      s.nextExpectedDate >= today &&
      s.nextExpectedDate.slice(0, 7) === month &&
      s.expectedAmountCents > 0,
  );
  const broken = (recurring.data ?? []).filter((s) => s.status === 'broken');
  const lastSpent = last.data?.totals.spentCents ?? null;
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;

  return (
    <div className="gutter mx-auto max-w-2xl pt-6 pb-12">
      <p className="type-label text-ink-muted">{monthName(month, false)} · left to spend</p>
      <p className="mt-1 type-display">
        <MoneyText cents={t.remainingCents} tone={t.remainingCents < 0 ? 'over' : 'ink'} whole />
      </p>
      <p className="mt-1 text-ink-muted">
        {t.availableCents === 0 ? (
          'Nothing planned yet this month.'
        ) : ahead > 0 ? (
          <>
            <MoneyText cents={ahead} tone="over" whole /> ahead of pace · day {p.pace.elapsedDays}{' '}
            of {p.pace.totalDays}
          </>
        ) : (
          <>
            On pace, <MoneyText cents={-ahead} whole /> to spare · day {p.pace.elapsedDays} of{' '}
            {p.pace.totalDays}
          </>
        )}
      </p>

      {accounts.data && (
        <div className="mt-6">
          <StaleNotes accounts={accounts.data} today={today} tz={me?.timezone} />
        </div>
      )}

      <section className="mt-8">
        {(queue.data?.count ?? 0) > 0 && (
          <NavRow
            to="/review"
            label="To review"
            value={
              <span className="rounded-full bg-sage-600 px-2 py-0.5 type-caption font-semibold text-surface money">
                {queue.data?.count}
              </span>
            }
          />
        )}
        {p.period.needsRecalc && (
          <NavRow
            to="/budget"
            label="Late spending in a closed month"
            value={<MoneyText cents={p.period.recalcDeltaCents} />}
          />
        )}
      </section>

      <section className="mt-8">
        <h2 className="type-title">Coming up</h2>
        {upcoming.length === 0 && broken.length === 0 ? (
          <p className="mt-2 text-ink-muted">
            No bills expected for the rest of {monthName(month, false)}.
          </p>
        ) : (
          <ul className="mt-2">
            {upcoming.map((s) => (
              <li
                key={s.id}
                className="flex min-h-12 items-center justify-between border-b border-hairline py-3"
              >
                <span>
                  {s.merchantNormalized}
                  <span className="ml-2 type-caption text-ink-faint">
                    {shortDate(s.nextExpectedDate ?? '')}
                    {catName(s.categoryId) ? ` · ${catName(s.categoryId)}` : ''}
                  </span>
                </span>
                <MoneyText cents={s.expectedAmountCents} />
              </li>
            ))}
            {broken.map((s) => (
              <li key={s.id} className="min-h-12 border-b border-hairline py-3 text-clay">
                {s.merchantNormalized} hasn't charged since it was due{' '}
                {shortDate(s.nextExpectedDate ?? '')}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="type-title">Spending</h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="type-label text-ink-muted">This month</p>
            <p className="money-lg">{formatCents(t.spentCents, { whole: true })}</p>
          </div>
          <div>
            <p className="type-label text-ink-muted">{monthName(addMonths(month, -1), false)}</p>
            <p className="money-lg text-ink-muted">
              {lastSpent === null ? '—' : formatCents(lastSpent, { whole: true })}
            </p>
          </div>
        </div>
        <p className="mt-2 type-caption text-ink-faint">
          Last month's full total; this month is {p.pace.elapsedDays} days in.
        </p>
        <Link to="/budget" className="mt-4 flex min-h-11 items-center text-sage-700">
          Open the budget ›
        </Link>
      </section>
    </div>
  );
}
