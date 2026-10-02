import { DetailPage } from '../components/detail/DetailPage';
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

  if (recurring.isPending) {
    return (
      <DetailPage
        header={{ back, title: 'Recurring' }}
        facts={<Skeleton className="my-4 h-24 w-full" />}
      />
    );
  }

  const all = recurring.data ?? [];
  const rows = all
    .filter((s) => s.status !== 'ended' && s.expectedAmountCents > 0)
    .sort((a, b) => (a.nextExpectedDate ?? '9999').localeCompare(b.nextExpectedDate ?? '9999'));
  const broken = all.filter((s) => s.status === 'broken');

  return (
    <DetailPage
      header={{ back, title: 'Recurring' }}
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
                </span>
                <MoneyText cents={s.expectedAmountCents} />
              </li>
            ))}
            {broken.map((s) => (
              <li
                key={`b-${s.id}`}
                className="min-h-12 border-b border-hairline py-3 text-clay last:border-b-0"
              >
                {merchantName(s)} hasn't charged since it was due{' '}
                {shortDate(s.nextExpectedDate ?? '')}.
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
