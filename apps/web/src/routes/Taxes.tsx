import { taxCsv, taxSummary } from '@rise/shared/reports';
import type { TaxLine } from '@rise/shared/schemas';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { IconButton } from '../components/primitives/Icon';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow, ValueRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { get } from '../lib/api';
import { useAccounts, useToday } from '../lib/queries';
import { INCOME_KINDS, defaultTaxYear, taxLabel } from '../lib/tax';

/** Financial health › Taxes: the year's totals by tax heading, and a CSV for the preparer. */
export function Taxes() {
  const today = useToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(() => defaultTaxYear(today));
  const accounts = useAccounts().data ?? [];
  const pack = useQuery({
    queryKey: ['reports', 'tax', year],
    queryFn: () => get<{ year: number; lines: TaxLine[] }>(`/reports/tax?year=${year}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const lines = pack.data?.lines ?? [];
  const heads = taxSummary(lines);
  const download = () => {
    const csv = taxCsv(lines, {
      kind: taxLabel,
      account: (id) => accounts.find((a) => a.id === id)?.name ?? '',
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rise-taxes-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <DetailPage
      header={{ back: { label: 'Financial health', to: '/financial-health' }, title: 'Taxes' }}
      identity={{
        label: 'Tax year',
        hero: (
          <span className="flex items-center gap-2">
            <IconButton
              icon="chevronLeft"
              label="Previous year"
              onClick={() => setYear(year - 1)}
            />
            <span className="money">{year}</span>
            <IconButton
              icon="chevronRight"
              label="Next year"
              disabled={year >= thisYear}
              onClick={() => setYear(year + 1)}
            />
          </span>
        ),
      }}
      facts={
        pack.isPending ? (
          <Skeleton className="my-3 h-24 w-full" />
        ) : heads.length === 0 ? (
          <div className="py-4">
            <p className="font-medium">Nothing marked for taxes in {year}</p>
            <p className="mt-1 text-ink-muted">
              Give a category or a tag a tax heading and its transactions add up here.
            </p>
          </div>
        ) : (
          heads.map((h) => (
            <ValueRow key={h.kind} label={taxLabel(h.kind)}>
              <MoneyText cents={h.totalCents} tone={INCOME_KINDS.has(h.kind) ? 'in' : 'ink'} />
            </ValueRow>
          ))
        )
      }
      related={heads.map((h) => ({
        title: taxLabel(h.kind),
        children: h.sources.map((s) => (
          <ValueRow
            key={s.source}
            label={
              <span className="flex flex-col">
                <span className="truncate text-ink">{s.source}</span>
                <span className="type-caption text-ink-faint">
                  {s.count} {s.count === 1 ? 'transaction' : 'transactions'}
                </span>
              </span>
            }
          >
            <MoneyText cents={s.totalCents} />
          </ValueRow>
        )),
      }))}
      manage={
        <>
          <div className="py-3">
            <Button className="w-full" disabled={lines.length === 0} onClick={download}>
              Download {year} CSV
            </Button>
          </div>
          <NavRow to="/settings/categories?from=Taxes|/financial-health/taxes" label="Categories" />
          <NavRow to="/settings/tags?from=Taxes|/financial-health/taxes" label="Tags" />
        </>
      }
    />
  );
}
