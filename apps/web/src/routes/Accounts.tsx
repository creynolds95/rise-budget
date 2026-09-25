import type { AccountKind } from '@rise/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { IconButton } from '../components/primitives/Icon';
import { Menu } from '../components/primitives/Menu';
import { StaleNotes, staleText } from '../components/StaleNotes';
import { Button } from '../components/primitives/Button';
import { Chart } from '../components/primitives/Chart';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { NavRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api } from '../lib/api';
import { allowsPercentChange, rangeStart, type Range } from '../lib/chart';
import { daysBetween, shortDate } from '../lib/dates';
import {
  useAccounts,
  useInvalidateMoney,
  useMe,
  useNetWorth,
  useSyncStatus,
  useToday,
} from '../lib/queries';
import type { AccountWithStaleness } from '../lib/types';

export const KIND_GROUPS: { kind: AccountKind; label: string }[] = [
  { kind: 'depository', label: 'Cash' },
  { kind: 'credit', label: 'Credit cards' },
  { kind: 'loan', label: 'Loans' },
  { kind: 'investment', label: 'Investments' },
  { kind: 'other', label: 'Other' },
];

/** Change over the window as a percent string, or null when §7 forbids one. */
export function percentChange(startCents: number, endCents: number, range: Range): string | null {
  if (!allowsPercentChange(range) || startCents === 0) return null;
  const tenths = Math.round(((endCents - startCents) * 1000) / Math.abs(startCents));
  const sign = tenths > 0 ? '+' : tenths < 0 ? '−' : '';
  return `${sign}${Math.floor(Math.abs(tenths) / 10)}.${Math.abs(tenths) % 10}%`;
}

/** T40. Net worth first, then every account grouped by kind, each with its staleness. */
export function Accounts() {
  const today = useToday();
  const tz = useMe().data?.timezone;
  const [range, setRange] = useState<Range>('6M');
  const accounts = useAccounts();
  const start = rangeStart(range, today);
  const nw = useNetWorth(start, today);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const navigate = useNavigate();

  const points = nw.data?.points ?? [];
  const first = points[0];
  const last = points.at(-1);
  // SPEC §5.3: no percentage over less than three months — of actual history, not just the chip.
  const pct =
    first && last && daysBetween(first.date, last.date) >= 90
      ? percentChange(first.netWorthCents, last.netWorthCents, range)
      : null;
  const live = (accounts.data ?? []).filter((a) => !a.archivedAt);

  const syncMode = useSyncStatus().data?.mode;
  const refresh = useMutation({
    mutationFn: () => api('POST', '/sync/run', {}),
    onSuccess: () =>
      Promise.all([
        invalidate(),
        ...['sync', 'review-queue', 'queue-count'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      ]),
  });

  return (
    <div className="mx-auto max-w-2xl pb-12">
      <header className="gutter flex items-center justify-between pt-3">
        <h1 className="type-title">Accounts</h1>
        <div className="-mr-2 flex items-center">
          <Menu
            label="Account options"
            items={[
              {
                label: refresh.isPending ? 'Refreshing…' : 'Refresh all',
                icon: 'refresh',
                disabled: refresh.isPending || !syncMode || syncMode === 'off',
                hint: syncMode === 'off' ? 'Connect SimpleFIN first' : undefined,
                onSelect: () => refresh.mutate(),
              },
              {
                label: 'Add a manual account',
                icon: 'wallet',
                onSelect: () => setAdding(true),
              },
              {
                label: 'Bank connection',
                icon: 'bank',
                onSelect: () => navigate('/settings/sync?from=Accounts|/accounts'),
              },
            ]}
          />
          <IconButton icon="plus" label="Add a manual account" onClick={() => setAdding(true)} />
        </div>
      </header>
      {refresh.isPending && (
        <p role="status" className="gutter type-caption text-ink-muted">
          Asking your banks for anything new…
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className="gutter type-caption text-clay">
          {refresh.error instanceof ApiError ? refresh.error.message : 'Refresh failed.'}
        </p>
      )}
      {refresh.isSuccess && (
        <p role="status" className="gutter type-caption text-ink-muted">
          Up to date as of just now.
        </p>
      )}
      <section className="gutter pt-4">
        <p className="type-label text-ink-muted">Net worth</p>
        <p className="mt-1 type-display">
          {last ? (
            <MoneyText
              cents={last.netWorthCents}
              tone={last.netWorthCents < 0 ? 'over' : 'ink'}
              whole
            />
          ) : (
            <Skeleton className="h-11 w-48" />
          )}
        </p>
        {first && last && first.date === last.date && (
          <p className="mt-1 text-ink-muted">
            History starts {shortDate(first.date)}, the first balance Rise saw.
          </p>
        )}
        {first && last && first.date !== last.date && (
          <p className="mt-1 text-ink-muted">
            <MoneyText
              cents={last.netWorthCents - first.netWorthCents}
              sign="always"
              tone="muted"
              whole
            />
            {pct && ` (${pct})`}{' '}
            {first.date > start
              ? `since ${shortDate(first.date)}`
              : `over ${range === 'ALL' ? 'three years' : range === 'YTD' ? 'this year' : range}`}
            {last.inferred && ' · includes estimated balances'}
          </p>
        )}
        <div className="mt-4">
          <Chart
            kind="line"
            label="Net worth over time. Dashed where balances are estimated between reports."
            points={points.map((p) => ({ cents: p.netWorthCents, inferred: p.inferred }))}
            range={range}
            onRange={setRange}
          />
        </div>
      </section>

      <section className="gutter mt-6">
        <StaleNotes accounts={live} today={today} tz={tz} />
      </section>

      {accounts.isPending && (
        <div className="gutter mt-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="mt-2 h-12 w-full" />
        </div>
      )}
      {KIND_GROUPS.map(({ kind, label }) => {
        const group = live.filter((a) => a.kind === kind);
        if (group.length === 0) return null;
        const total = group.reduce((n, a) => n + (a.includeInNetWorth ? a.balanceCents : 0), 0);
        return (
          <section key={kind} className="gutter mt-6">
            <h2 className="flex items-baseline justify-between type-label text-ink-muted">
              <span>{label}</span>
              <MoneyText cents={total} tone="muted" />
            </h2>
            <div className="mt-1 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
              {group.map((a) => (
                <AccountRow key={a.id} a={a} today={today} tz={tz} />
              ))}
            </div>
          </section>
        );
      })}
      {accounts.data && live.length === 0 && (
        <p className="gutter mt-6 text-ink-muted">
          No accounts yet. Synced accounts appear after the first sync; add anything else by hand.
        </p>
      )}
      <AddAccountSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AccountRow({
  a,
  today,
  tz,
}: {
  a: AccountWithStaleness;
  today: string;
  tz?: string | undefined;
}) {
  const stale = staleText(a, today, tz);
  return (
    <NavRow
      to={`/accounts/${a.id}`}
      label={
        <span>
          {a.name}
          {a.mask && <span className="text-ink-faint"> ··{a.mask}</span>}
          <span className={`block type-caption ${stale ? 'text-gold-text' : 'text-ink-faint'}`}>
            {stale
              ? 'Not up to date'
              : a.source === 'manual'
                ? 'Manual'
                : (a.institutionName ?? 'Synced')}
            {!a.includeInNetWorth && ' · not in net worth'}
          </span>
        </span>
      }
      value={<MoneyText cents={a.balanceCents} tone={a.balanceCents < 0 ? 'muted' : 'ink'} />}
    />
  );
}

/** Manual accounts: a car loan, a 401(k) — anything SimpleFIN doesn't reach. */
function AddAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const today = useToday();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('loan');
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const field = 'min-h-11 w-full rounded-input border border-hairline bg-surface px-3';
  const owes = kind === 'loan' || kind === 'credit';
  return (
    <Sheet open={open} title="New manual account" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const a = await api<{ id: string }>('POST', '/accounts', {
              name: name.trim(),
              kind,
              includeInBudget: false,
            });
            // Liabilities are stored negative (SPEC §1.1); people type what they owe.
            await api('POST', `/accounts/${a.id}/snapshots`, {
              asOf: today,
              balanceCents: owes ? -balance : balance,
            });
            await Promise.all(
              ['accounts', 'networth'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
            );
            setName('');
            setBalance(0);
            onClose();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save.');
          }
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="type-label text-ink-muted">Name</span>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Car loan"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="type-label text-ink-muted">Kind</span>
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as AccountKind)}
          >
            {KIND_GROUPS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="type-label text-ink-muted">
            {owes ? 'Amount owed today' : 'Balance today'}
          </span>
          <MoneyField label="Balance today" cents={balance} onCommit={setBalance} />
        </label>
        {error && <p className="text-clay">{error}</p>}
        <Button type="submit" disabled={!name.trim()}>
          Add account
        </Button>
      </form>
    </Sheet>
  );
}
