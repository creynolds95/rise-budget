import { Loading } from '../components/Pending';
import { DetailPage } from '../components/detail/DetailPage';
import { MissedRow, useMissed } from '../components/MissedCharges';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { radarNotes, yearlyCost } from '../lib/alerts';
import { shortDate } from '../lib/dates';
import { merchantName } from '../lib/merchant';
import { useCategories, useMe, useRecurring, useToday } from '../lib/queries';

/** Every active recurring charge, soonest first. Pushed from the Dashboard menu. */
export function Recurring() {
  const today = useToday();
  const recurring = useRecurring();
  const alerts = useMe().data?.settings.alerts;
  const categories = useCategories();
  const back = { label: 'Dashboard', to: '/' };
  const broken = useMissed(recurring.data);

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

  return (
    <DetailPage
      header={{ back, title: 'Recurring' }}
      identity={
        rows.length > 0
          ? { label: 'A year of recurring charges', hero: <MoneyText cents={yearlyCost(all)} /> }
          : undefined
      }
      facts={
        rows.length === 0 && broken.length === 0 ? (
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
                  {radarNotes(s, alerts).map((n) => (
                    <span key={n} className="flex items-center gap-2 type-caption text-ink">
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-gold" />
                      {n}
                    </span>
                  ))}
                </span>
                <MoneyText cents={s.expectedAmountCents} />
              </li>
            ))}
            {broken.map((s) => (
              <MissedRow key={`b-${s.id}`} s={s} today={today} all={all} />
            ))}
          </ul>
        )
      }
    />
  );
}
