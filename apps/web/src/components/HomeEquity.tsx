import type { HomeEquity as Home } from '@rise/shared/schemas';
import { netWorthSeries } from '@rise/shared/networth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from './primitives/Button';
import { Chart } from './primitives/Chart';
import { MoneyField } from './primitives/MoneyField';
import { MoneyText } from './primitives/MoneyText';
import { Sheet } from './primitives/Sheet';
import { Skeleton } from './primitives/Skeleton';
import { api, get } from '../lib/api';
import { rangeStart, type Range } from '../lib/chart';
import { shortDate } from '../lib/dates';
import { equityCents } from '../lib/homeEquity';
import { useAccounts, useMe, useToday } from '../lib/queries';

type Snap = { asOf: string; balanceCents: number };

/** Set or change the home's value and which loan is its mortgage. Nothing saves until Save. */
export function HomeEquitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const accounts = useAccounts().data ?? [];
  const qc = useQueryClient();
  const home = me?.settings.home ?? null;
  const loans = accounts.filter((a) => a.kind === 'loan' && !a.archivedAt);
  const [value, setValue] = useState(home?.valueCents ?? 0);
  const [loanId, setLoanId] = useState<string | null>(home?.mortgageAccountId ?? null);
  const save = useMutation({
    mutationFn: (h: Home | null) => api('PATCH', '/me/settings', { home: h }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const valid = value > 0 && loanId !== null;
  return (
    <Sheet
      open={open}
      title="Home equity"
      onClose={onClose}
      action={{
        label: 'Save',
        disabled: !valid,
        onClick: () => {
          if (!valid || loanId === null) return;
          save.mutate({ valueCents: value, mortgageAccountId: loanId });
          onClose();
        },
      }}
    >
      <div className="flex min-h-13 items-center justify-between gap-3 rounded-card bg-surface px-4 shadow-soft">
        <span>Home value</span>
        <MoneyField cents={value} onCommit={setValue} label="Home value" draft />
      </div>
      <p className="type-label mt-6 mb-2 text-ink-muted">Mortgage</p>
      <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {loans.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              role="radio"
              aria-checked={loanId === a.id}
              onClick={() => setLoanId(a.id)}
              className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="flex items-center gap-3">
                <MoneyText cents={a.balanceCents} tone="muted" />
                <span
                  aria-hidden
                  className={`size-5 rounded-full border ${
                    loanId === a.id ? 'border-sage-600 bg-sage-600' : 'border-hairline'
                  }`}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {home && (
        <div className="mt-6">
          <Button
            variant="quiet"
            onClick={() => {
              save.mutate(null);
              onClose();
            }}
          >
            Remove home equity
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Dashboard tile: equity now, and its trend as the mortgage is paid down. Hidden until set up. */
export function HomeEquityTile() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const [range, setRange] = useState<Range>('6M');
  const [editing, setEditing] = useState(false);
  const home = me?.settings.home ?? null;
  const loan = accounts?.find((a) => a.id === home?.mortgageAccountId);
  const snaps = useQuery({
    queryKey: ['snapshots', home?.mortgageAccountId],
    queryFn: () => get<Snap[]>(`/accounts/${home?.mortgageAccountId}/snapshots`),
    enabled: Boolean(home),
  });
  if (!home || !accounts) return null;
  if (!loan) return null;

  const equity = equityCents(home.valueCents, loan.balanceCents);
  const start = rangeStart(range, today);
  const first = (snaps.data ?? []).reduce<string | null>(
    (m, s) => (m === null || s.asOf < m ? s.asOf : m),
    null,
  );
  const points = (
    first
      ? netWorthSeries(
          [{ accountId: loan.id, includeInNetWorth: true, snapshots: snaps.data ?? [] }],
          start,
          today,
        ).filter((p) => p.date >= first)
      : []
  ).map((p) => ({
    date: p.date,
    cents: equityCents(home.valueCents, p.netWorthCents),
    inferred: p.inferred,
  }));
  const a = points[0];
  const z = points.at(-1);

  return (
    <section className="mt-10">
      <h2 className="type-title">Home equity</h2>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (!(e.target as Element).closest('button')) setEditing(true);
        }}
        onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
        className="mt-1 cursor-pointer overflow-hidden rounded-card bg-surface p-4 shadow-soft"
      >
        <p className="type-display">
          <MoneyText cents={equity} tone={equity < 0 ? 'over' : 'ink'} whole />
        </p>
        {a && z && a.date !== z.date && (
          <p className="mt-1 text-ink-muted">
            <MoneyText cents={z.cents - a.cents} sign="always" tone="muted" whole />{' '}
            {a.date > start
              ? `since ${shortDate(a.date)}`
              : `over ${range === 'ALL' ? 'three years' : range === 'YTD' ? 'this year' : range}`}
          </p>
        )}
        <div className="mt-4">
          {snaps.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Chart
              kind="line"
              label="Home equity over time, at today's home value. Dashed where estimated between reports."
              points={points.map((p) => ({
                cents: p.cents,
                inferred: p.inferred,
                label: shortDate(p.date),
              }))}
              range={range}
              onRange={setRange}
            />
          )}
        </div>
      </div>
      {editing && <HomeEquitySheet key="edit" open onClose={() => setEditing(false)} />}
    </section>
  );
}
