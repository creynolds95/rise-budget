import { netWorthSeries } from '@rise/shared/networth';
import { isLiabilityKind, type AccountKind } from '@rise/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { staleText } from '../components/StaleNotes';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Toggle } from '../components/primitives/Toggle';
import { Chart } from '../components/primitives/Chart';
import { Icon } from '../components/primitives/Icon';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, NavRow, StaticRow } from '../components/primitives/Rows';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { rangeStart, type Range } from '../lib/chart';
import { localToday, longDate, shortDate } from '../lib/dates';
import { useAccounts, useInvalidateMoney, useMe, useToday, useTransactions } from '../lib/queries';

interface Snap {
  asOf: string;
  balanceCents: number;
}

/** The Summary card's editable fields. Balance is as shown: owed amounts are positive. */
interface Draft {
  name: string;
  kind: AccountKind;
  balance: number;
  asOf: string;
  expectedPaymentCents: number;
  paymentDay: number | null;
  syncCadenceHours: number;
  includeInBudget: boolean;
  includeInNetWorth: boolean;
}

const HISTORY_PREVIEW = 6;

/** T40. Balance, its history (dashed between reports), the facts, and manual snapshot entry.
 *  Summary edits are held until Save; a changed balance is recorded as of a date. */
export function AccountDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const today = useToday();
  const tz = useMe().data?.timezone;
  const accounts = useAccounts();
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>('6M');
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [saving, setSaving] = useState(false);
  const snaps = useQuery({
    queryKey: ['snapshots', id],
    queryFn: () => get<Snap[]>(`/accounts/${id}/snapshots`),
  });
  const txns = useTransactions({ account: id });
  const a = accounts.data?.find((x) => x.id === id);
  const back = { label: 'Accounts', to: '/accounts' };
  useEffect(() => setEdits({}), [id]);

  if (!a) {
    return (
      <DetailPage
        header={{ back, title: '' }}
        identity={{ label: 'Balance', hero: <Skeleton className="h-11 w-40" /> }}
      />
    );
  }
  const manual = a.source === 'manual';
  const owes = isLiabilityKind(a.kind);
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

  const base: Draft = {
    name: a.name,
    kind: a.kind,
    balance: owes ? -a.balanceCents : a.balanceCents,
    asOf: today,
    expectedPaymentCents: a.expectedPaymentCents ?? 0,
    paymentDay: a.paymentDay ?? null,
    syncCadenceHours: a.syncCadenceHours ?? 24,
    includeInBudget: a.includeInBudget,
    includeInNetWorth: a.includeInNetWorth,
  };
  const d: Draft = { ...base, ...edits };
  const set = (patch: Partial<Draft>) => setEdits((e) => ({ ...e, ...patch }));
  const balanceChanged = manual && d.balance !== base.balance;
  const patchBody: Record<string, unknown> = {};
  if (manual && d.name.trim() !== base.name) patchBody.name = d.name.trim();
  if (d.kind !== base.kind) patchBody.kind = d.kind;
  if (d.expectedPaymentCents !== base.expectedPaymentCents)
    patchBody.expectedPaymentCents = d.expectedPaymentCents || null;
  if (d.paymentDay !== base.paymentDay) patchBody.paymentDay = d.paymentDay;
  if (!manual && d.syncCadenceHours !== base.syncCadenceHours)
    patchBody.syncCadenceHours = d.syncCadenceHours;
  if (d.includeInBudget !== base.includeInBudget) patchBody.includeInBudget = d.includeInBudget;
  if (d.includeInNetWorth !== base.includeInNetWorth)
    patchBody.includeInNetWorth = d.includeInNetWorth;
  const dirty = balanceChanged || Object.keys(patchBody).length > 0;
  const invalid = (manual && !d.name.trim()) || d.asOf > today;

  const discard = () => {
    setEdits({});
    setError(null);
  };
  const save = async () => {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Kind first: crossing the liability line flips stored balances, and the new balance
      // is then signed for the kind it now is.
      if (Object.keys(patchBody).length > 0) await api('PATCH', `/accounts/${id}`, patchBody);
      if (balanceChanged) {
        await api('POST', `/accounts/${id}/snapshots`, {
          asOf: d.asOf,
          balanceCents: isLiabilityKind(d.kind) ? -d.balance : d.balance,
        });
      }
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['snapshots', id] })]);
      setEdits({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  const list = txns.data?.pages.flatMap((p) => p.items) ?? [];
  const select =
    'min-h-11 rounded-input border border-hairline bg-surface px-2 [text-align-last:right]';
  const draftOwes = isLiabilityKind(d.kind);

  return (
    <DetailPage
      header={{
        back,
        title: a.name,
        action: dirty ? (
          <button
            type="button"
            disabled={invalid || saving}
            onClick={() => void save()}
            className="min-h-11 px-2 font-semibold text-banner-ink disabled:opacity-50"
          >
            Save
          </button>
        ) : undefined,
      }}
      identity={{
        // A card paid past zero holds a credit, not a negative debt (C13).
        label: owes ? (a.balanceCents > 0 ? 'Credit' : 'Owed') : 'Balance',
        hero: <MoneyText cents={owes && a.balanceCents <= 0 ? -a.balanceCents : a.balanceCents} />,
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
          points={known.map((p) => ({
            cents: p.netWorthCents,
            inferred: p.inferred,
            label: shortDate(p.date),
          }))}
          range={range}
          onRange={setRange}
        />
      }
      factsTitle="Transactions"
      facts={
        manual ? undefined : (
          <>
            {list.length === 0 && <p className="py-3 text-ink-muted">None yet.</p>}
            {list.slice(0, 5).map((t) => (
              <TxnRow key={t.id} t={t} from={`${a.name}|/accounts/${id}`} />
            ))}
            {list.length > 5 && (
              <NavRow to={`/transactions?account=${id}`} label="All transactions" />
            )}
          </>
        )
      }
      related={[
        {
          title: 'Summary',
          children: (
            <>
              {manual && (
                <EditRow
                  label="Name"
                  field={
                    <input
                      aria-label="Account name"
                      className="min-h-11 w-48 rounded-input border border-hairline bg-surface px-3 text-right focus:border-sage-600 focus:outline-none"
                      value={d.name}
                      onChange={(e) => set({ name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  }
                />
              )}
              <EditRow
                label="Type"
                field={
                  <select
                    aria-label="Account type"
                    className={select}
                    value={d.kind}
                    onChange={(e) => set({ kind: e.target.value as AccountKind })}
                  >
                    <option value="depository">Cash</option>
                    <option value="credit">Credit card</option>
                    <option value="loan">Loan</option>
                    <option value="investment">Investment</option>
                    <option value="other">Other</option>
                  </select>
                }
              />
              {manual && (
                <EditRow
                  label={draftOwes ? 'Owed' : 'Balance'}
                  field={
                    <MoneyField
                      label={draftOwes ? 'Owed' : 'Balance'}
                      cents={d.balance}
                      onCommit={(v) => set({ balance: v })}
                    />
                  }
                />
              )}
              {balanceChanged && (
                <EditRow
                  label="As of"
                  field={
                    <input
                      type="date"
                      aria-label="As of"
                      max={today}
                      value={d.asOf}
                      onChange={(e) => e.target.value && set({ asOf: e.target.value })}
                      className={`min-h-11 rounded-input border bg-surface px-2 ${
                        d.asOf > today ? 'border-clay' : 'border-hairline'
                      }`}
                    />
                  }
                />
              )}
              {d.kind === 'loan' && (
                <>
                  <EditRow
                    label="Monthly payment"
                    field={
                      <MoneyField
                        label="Monthly payment"
                        cents={d.expectedPaymentCents}
                        onCommit={(v) => set({ expectedPaymentCents: v })}
                      />
                    }
                  />
                  <EditRow
                    label="Payment day"
                    field={
                      <select
                        aria-label="Payment day"
                        className={select}
                        value={d.paymentDay ?? ''}
                        onChange={(e) =>
                          set({ paymentDay: e.target.value ? Number(e.target.value) : null })
                        }
                      >
                        <option value="">Not set</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            Day {n}
                          </option>
                        ))}
                      </select>
                    }
                  />
                </>
              )}
              {!manual && (
                <EditRow
                  label="Updates every"
                  field={
                    <select
                      aria-label="Sync cadence"
                      className={select}
                      value={d.syncCadenceHours}
                      onChange={(e) => set({ syncCadenceHours: Number(e.target.value) })}
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
                    on={d.includeInBudget}
                    onChange={(v) => set({ includeInBudget: v })}
                  />
                }
              />
              <EditRow
                label="Counts toward net worth"
                field={
                  <Toggle
                    label="Counts toward net worth"
                    on={d.includeInNetWorth}
                    onChange={(v) => set({ includeInNetWorth: v })}
                  />
                }
              />
              {a.institutionName && <StaticRow label="Institution" value={a.institutionName} />}
              <StaticRow label="Source" value={manual ? 'Manual' : 'SimpleFIN'} />
              {error && <p className="py-2 text-clay">{error}</p>}
              {dirty && (
                <div className="flex gap-2 py-3">
                  <Button
                    className="flex-1"
                    disabled={invalid || saving}
                    onClick={() => void save()}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                  <Button variant="quiet" className="flex-1" disabled={saving} onClick={discard}>
                    Discard
                  </Button>
                </div>
              )}
            </>
          ),
        },
        ...(manual && (snaps.data?.length ?? 0) > 0
          ? [
              {
                title: 'Balance history',
                children: (
                  <BalanceHistory
                    id={id}
                    owes={owes}
                    snaps={snaps.data ?? []}
                    onChanged={async () => {
                      await Promise.all([
                        invalidate(),
                        qc.invalidateQueries({ queryKey: ['snapshots', id] }),
                      ]);
                    }}
                  />
                ),
              },
            ]
          : []),
      ]}
      manage={
        manual ? (
          <AccountManage
            id={id}
            name={a.name}
            onDone={async () => {
              await invalidate();
              navigate('/accounts');
            }}
          />
        ) : a.kind === 'loan' ? (
          <ConvertToManual
            id={id}
            name={a.name}
            onDone={async () => {
              await invalidate();
            }}
          />
        ) : undefined
      }
    />
  );
}

/** Every balance entered by hand, newest first. A mistyped one can be taken back; the last
 *  one can't, since the account always needs a balance. */
function BalanceHistory({
  id,
  owes,
  snaps,
  onChanged,
}: {
  id: string;
  owes: boolean;
  snaps: Snap[];
  onChanged: () => Promise<void>;
}) {
  const [all, setAll] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = [...snaps].sort((x, y) => (x.asOf < y.asOf ? 1 : -1));
  const shown = all ? rows : rows.slice(0, HISTORY_PREVIEW);

  const remove = async (asOf: string) => {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/accounts/${id}/snapshots/${asOf}`);
      await onChanged();
      setRemoving(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {shown.map((s) =>
        removing === s.asOf ? (
          <div
            key={s.asOf}
            className="flex min-h-12 items-center justify-between gap-2 border-b border-hairline py-2"
          >
            <span className="min-w-0 text-ink">Remove {shortDate(s.asOf)}?</span>
            <span className="flex shrink-0 gap-1">
              <Button variant="danger" disabled={busy} onClick={() => void remove(s.asOf)}>
                Remove
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setRemoving(null)}>
                Keep
              </Button>
            </span>
          </div>
        ) : (
          <div
            key={s.asOf}
            className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-1"
          >
            <span className="text-ink-muted">{longDate(s.asOf)}</span>
            <span className="flex items-center gap-1">
              <MoneyText cents={owes ? -s.balanceCents : s.balanceCents} />
              {rows.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove balance from ${longDate(s.asOf)}`}
                  onClick={() => {
                    setError(null);
                    setRemoving(s.asOf);
                  }}
                  className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink-faint active:bg-sage-100"
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </span>
          </div>
        ),
      )}
      {error && <p className="py-2 text-clay">{error}</p>}
      {rows.length > HISTORY_PREVIEW && (
        <div className="-ml-4">
          <Button variant="quiet" onClick={() => setAll((v) => !v)}>
            {all ? 'Show less' : `Show all ${rows.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

/** A synced loan the bank can't keep fresh: detach it so Debt tracks the balance by hand. */
function ConvertToManual({
  id,
  name,
  onDone,
}: {
  id: string;
  name: string;
  onDone: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <div className="-ml-4">
        <Button variant="quiet" onClick={() => setAsking(true)}>
          Convert to manual
        </Button>
      </div>
    );
  }
  return (
    <div className="w-full rounded-card bg-surface p-4 shadow-soft">
      <p className="font-medium">Convert {name} to manual?</p>
      <p className="mt-1 type-caption text-ink-muted">
        It stops syncing from SimpleFIN and keeps its history. You set its balance yourself, and
        Debt can then track it.
      </p>
      {error && <p className="mt-2 type-caption text-clay">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api('POST', `/accounts/${id}/convert-to-manual`, {});
              await onDone();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not convert.');
              setBusy(false);
            }
          }}
        >
          Convert
        </Button>
        <Button variant="quiet" className="flex-1" onClick={() => setAsking(false)}>
          Keep syncing
        </Button>
      </div>
    </div>
  );
}

/** Close keeps the account's snapshots in net worth; delete erases them. Each needs its own
 *  explicit confirmation naming what happens (§5.2) — closing and deleting are not the same risk. */
function AccountManage({
  id,
  name,
  onDone,
}: {
  id: string;
  name: string;
  onDone: () => Promise<void>;
}) {
  const [pending, setPending] = useState<'close' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
      setBusy(false);
    }
  };

  const cancel = () => {
    setPending(null);
    setError(null);
  };

  if (pending === 'close') {
    return (
      <div className="w-full rounded-card bg-surface p-4 shadow-soft">
        <p className="font-medium">Close {name}?</p>
        <p className="mt-1 type-caption text-ink-muted">
          It leaves your account list, but its past balances still count toward net worth.
        </p>
        {error && <p className="mt-2 type-caption text-clay">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              run(() => api('POST', `/accounts/${id}/archive`, {}), 'Could not close.')
            }
          >
            Close account
          </Button>
          <Button variant="quiet" className="flex-1" onClick={cancel}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }
  if (pending === 'delete') {
    return (
      <div className="w-full rounded-card bg-surface p-4 shadow-soft">
        <p className="font-medium">Delete {name} and its history?</p>
        <p className="mt-1 type-caption text-ink-muted">
          Every balance ever recorded for it is gone, including from net worth. This can&rsquo;t be
          undone.
        </p>
        {error && <p className="mt-2 type-caption text-clay">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button
            variant="danger"
            className="flex-1 border border-clay"
            disabled={busy}
            onClick={() => run(() => api('DELETE', `/accounts/${id}`), 'Could not delete.')}
          >
            Delete for good
          </Button>
          <Button variant="quiet" className="flex-1" onClick={cancel}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="-ml-4 flex flex-col items-start gap-1">
      <Button variant="quiet" onClick={() => setPending('close')}>
        Close account
      </Button>
      <Button variant="danger" onClick={() => setPending('delete')}>
        Delete account and history
      </Button>
    </div>
  );
}
