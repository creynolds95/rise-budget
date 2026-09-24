import { netWorthSeries } from '@rise/shared/networth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { staleText } from '../components/StaleNotes';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Chart } from '../components/primitives/Chart';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, NavRow, StaticRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { rangeStart, type Range } from '../lib/chart';
import { localToday, shortDate } from '../lib/dates';
import { useAccounts, useInvalidateMoney, useMe, useToday, useTransactions } from '../lib/queries';

interface Snap {
  asOf: string;
  balanceCents: number;
}

/** T40. Balance, its history (dashed between reports), the facts, and manual snapshot entry. */
export function AccountDetail() {
  const { id = '' } = useParams();
  const today = useToday();
  const tz = useMe().data?.timezone;
  const accounts = useAccounts();
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>('6M');
  const [error, setError] = useState<string | null>(null);
  const snaps = useQuery({
    queryKey: ['snapshots', id],
    queryFn: () => get<Snap[]>(`/accounts/${id}/snapshots`),
  });
  const txns = useTransactions({ account: id });
  const a = accounts.data?.find((x) => x.id === id);
  const back = { label: 'Accounts', to: '/accounts' };

  if (!a) {
    return (
      <DetailPage
        header={{ back, title: '' }}
        identity={{ label: 'Balance', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }
  const manual = a.source === 'manual';
  const owes = a.kind === 'credit' || a.kind === 'loan';
  const stale = staleText(a, today, tz);
  const series = netWorthSeries(
    [{ accountId: a.id, includeInNetWorth: true, snapshots: snaps.data ?? [] }],
    rangeStart(range, today),
    today,
  );
  // Before the first report there is nothing to draw, not a zero balance.
  const firstReport = (snaps.data ?? []).reduce<string | null>(
    (m, s) => (m === null || s.asOf < m ? s.asOf : m),
    null,
  );
  const known = firstReport ? series.filter((p) => p.date >= firstReport) : [];
  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await api('PATCH', `/accounts/${id}`, body);
      await invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };
  const list = txns.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <DetailPage
      header={{ back, title: a.name }}
      identity={{
        label: owes ? 'Owed' : 'Balance',
        hero: <MoneyText cents={owes ? -a.balanceCents : a.balanceCents} />,
        context: stale ? (
          <span className="text-gold-text">{stale}</span>
        ) : a.lastSyncedAt ? (
          `As of ${shortDate(localToday(tz, new Date(a.lastSyncedAt)))}`
        ) : manual ? (
          'Updated by hand'
        ) : undefined,
      }}
      shape={
        <Chart
          kind="line"
          label={`${a.name} balance over time. Dashed where estimated between reports.`}
          points={known.map((p) => ({ cents: p.netWorthCents, inferred: p.inferred }))}
          range={range}
          onRange={setRange}
        />
      }
      facts={
        <>
          {manual && (
            <EditRow
              label={owes ? 'Owed today' : 'Balance today'}
              field={
                <MoneyField
                  label="Balance today"
                  cents={owes ? -a.balanceCents : a.balanceCents}
                  onCommit={async (v) => {
                    try {
                      await api('POST', `/accounts/${id}/snapshots`, {
                        asOf: today,
                        balanceCents: owes ? -v : v,
                      });
                      await Promise.all([
                        invalidate(),
                        qc.invalidateQueries({ queryKey: ['snapshots', id] }),
                      ]);
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Could not save.');
                    }
                  }}
                />
              }
            />
          )}
          {a.kind === 'loan' && (
            <>
              <EditRow
                label="Monthly payment"
                field={
                  <MoneyField
                    label="Monthly payment"
                    cents={a.expectedPaymentCents ?? 0}
                    onCommit={(v) => void patch({ expectedPaymentCents: v || null })}
                  />
                }
              />
              <EditRow
                label="Payment day"
                field={
                  <select
                    aria-label="Payment day"
                    className="min-h-11 rounded-input border border-hairline bg-surface px-2"
                    value={a.paymentDay ?? ''}
                    onChange={(e) =>
                      void patch({ paymentDay: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    <option value="">Not set</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        Day {d}
                      </option>
                    ))}
                  </select>
                }
              />
            </>
          )}
          {!manual && (
            <EditRow
              label="Bank reports every"
              field={
                <select
                  aria-label="Sync cadence"
                  className="min-h-11 rounded-input border border-hairline bg-surface px-2"
                  value={a.syncCadenceHours ?? 24}
                  onChange={(e) => void patch({ syncCadenceHours: Number(e.target.value) })}
                >
                  <option value={24}>Day</option>
                  <option value={168}>Week</option>
                  <option value={720}>Month</option>
                </select>
              }
            />
          )}
          <EditRow
            label="Counts toward budget"
            field={
              <Toggle
                label="Counts toward budget"
                on={a.includeInBudget}
                onChange={(v) => void patch({ includeInBudget: v })}
              />
            }
          />
          <EditRow
            label="Counts toward net worth"
            field={
              <Toggle
                label="Counts toward net worth"
                on={a.includeInNetWorth}
                onChange={(v) => void patch({ includeInNetWorth: v })}
              />
            }
          />
          {a.institutionName && <StaticRow label="Institution" value={a.institutionName} />}
          <StaticRow label="Source" value={manual ? 'Manual' : 'SimpleFIN'} />
          {error && <p className="py-2 text-clay">{error}</p>}
        </>
      }
      related={
        manual
          ? undefined
          : {
              title: 'Recent transactions',
              children: (
                <>
                  {list.length === 0 && <p className="py-3 text-ink-muted">None yet.</p>}
                  {list.slice(0, 5).map((t) => (
                    <TxnRow key={t.id} t={t} from={`${a.name}|/accounts/${id}`} />
                  ))}
                  {list.length > 5 && (
                    <NavRow to={`/transactions?account=${id}`} label="All transactions" />
                  )}
                </>
              ),
            }
      }
      manage={
        manual ? (
          <Button
            variant="danger"
            className="-ml-4"
            onClick={async () => {
              if (!window.confirm(`Stop counting ${a.name}? Its history stays.`)) return;
              await patch({ includeInNetWorth: false, includeInBudget: false });
            }}
          >
            Stop counting this account
          </Button>
        ) : undefined
      }
    />
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 rounded-full transition-colors ${on ? 'bg-sage-600' : 'bg-hairline'}`}
    >
      <span
        className={`absolute top-0.5 left-0 size-6 rounded-full bg-surface shadow-soft transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
