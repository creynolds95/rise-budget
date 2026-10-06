import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Chart } from '../components/primitives/Chart';
import { IconButton } from '../components/primitives/Icon';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow, ValueRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { series } from '../design/tokens';
import { api } from '../lib/api';
import { isDue, levelPayment } from '@rise/shared/debt';
import { DEFAULT_DEBT_PLAN, aprFromText, aprToText, owedCents } from '../lib/debt';
import { addMonths, monthName, periodOf } from '../lib/dates';
import { formatCents } from '../lib/money';
import { equityOf, homeAccount, lineSeries, mortgageView } from '../lib/mortgage';
import { useAccounts, useMe, useToday } from '../lib/queries';

const field =
  'inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600';

/** A percent or whole-number box that commits on blur and reverts what it can't read. */
function NumberBox({
  label,
  value,
  parse,
  show,
  onCommit,
  suffix,
  width = 'w-16',
}: {
  label: string;
  value: number;
  parse: (t: string) => number | null;
  show: (n: number) => string;
  onCommit: (n: number) => void;
  suffix?: string;
  width?: string;
}) {
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value, show]);
  const commit = () => {
    const n = parse(text);
    if (n === null) return setText(show(value));
    if (n !== value) onCommit(n);
  };
  return (
    <span className={field}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`money ${width} bg-transparent text-right outline-none`}
      />
      {suffix && <span className="ml-1 text-ink-muted">{suffix}</span>}
    </span>
  );
}

const parseInt1 = (t: string): number | null => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isInteger(n) && n >= 12 && n <= 600 ? n : null;
};
const parseLeft = (t: string): number | null => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 600 ? n : null;
};
const showInt = (n: number) => String(n);

/** A wide two-way switch. */
function Pill<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-full gap-1 rounded-full bg-sage-100 p-1"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`min-h-11 flex-1 rounded-full type-caption font-medium ${
            o.id === value ? 'bg-surface text-sage-700 shadow-soft' : 'text-ink-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 150 months as "12 yr 6 mo". */
const duration = (months: number): string => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? `${y} yr` : '', m > 0 ? `${m} mo` : ''].filter(Boolean).join(' ');
};

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      <span className="font-medium text-ink">{label}</span>
    </li>
  );
}

/** Interest against principal in a ring; the share on each side, the dollars beneath. */
export function Donut({ principal, interest }: { principal: number; interest: number }) {
  const total = principal + interest;
  const r = 40;
  const c = 2 * Math.PI * r;
  const share = total === 0 ? 0 : principal / total;
  const pct = (n: number) => `${Math.round((total === 0 ? 0 : n / total) * 100)}%`;
  return (
    <figure className="m-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
      <figcaption className="contents">
        <span>
          <span className="block type-title money" style={{ color: series[2] }}>
            {pct(interest)}
          </span>
          <span className="block type-caption text-ink-muted">Interest</span>
          <MoneyText cents={interest} />
        </span>
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label="Interest and principal paid this year"
          className="size-32 -rotate-90"
        >
          <circle cx={50} cy={50} r={r} fill="none" stroke={series[2]} strokeWidth={14} />
          <circle
            cx={50}
            cy={50}
            r={r}
            fill="none"
            stroke={series[0]}
            strokeWidth={14}
            strokeDasharray={`${share * c} ${c}`}
          />
        </svg>
        <span>
          <span className="block type-title money" style={{ color: series[0] }}>
            {pct(principal)}
          </span>
          <span className="block type-caption text-ink-muted">Principal</span>
          <MoneyText cents={principal} />
        </span>
      </figcaption>
    </figure>
  );
}

function AddPaymentSheet({
  open,
  onClose,
  min,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  min: string;
  onSave: (period: string, cents: number) => void;
}) {
  const [period, setPeriod] = useState(min);
  const [cents, setCents] = useState(0);
  const valid = /^\d{4}-\d{2}$/.test(period) && period >= min && cents > 0;
  return (
    <Sheet
      open={open}
      title="One-time payment"
      onClose={onClose}
      action={{
        label: 'Add',
        disabled: !valid,
        onClick: () => {
          onSave(period, cents);
          onClose();
        },
      }}
    >
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Month"
          field={
            <input
              aria-label="Month"
              type="month"
              min={min}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="min-h-11 rounded-input border border-hairline bg-surface px-3 outline-none focus:border-sage-600"
            />
          }
        />
        <EditRow
          label="Amount"
          field={<MoneyField label="Amount" cents={cents} draft onCommit={setCents} />}
        />
      </div>
    </Sheet>
  );
}

function AccountSheet({
  open,
  onClose,
  accounts,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; owedCents: number }[];
  onPick: (id: string) => void;
}) {
  return (
    <Sheet open={open} title="Mortgage account" onClose={onClose}>
      <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {accounts.length === 0 && (
          <li className="px-4 py-3 text-ink-muted">No loan accounts available.</li>
        )}
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => {
                onPick(a.id);
                onClose();
              }}
              className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{a.name}</span>
              <MoneyText cents={a.owedCents} tone="muted" />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function HomeValueSheet({
  open,
  onClose,
  accounts,
  selectedId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; balanceCents: number }[];
  selectedId: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <Sheet open={open} title="Home value account" onClose={onClose}>
      <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {[{ id: null, name: 'None', balanceCents: null }, ...accounts].map((a) => (
          <li key={a.id ?? 'none'}>
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === a.id}
              onClick={() => {
                onPick(a.id);
                onClose();
              }}
              className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-sage-100"
            >
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="flex items-center gap-3">
                {a.balanceCents !== null && <MoneyText cents={a.balanceCents} tone="muted" />}
                <span
                  aria-hidden
                  className={`size-5 rounded-full border ${
                    selectedId === a.id ? 'border-sage-600 bg-sage-600' : 'border-hairline'
                  }`}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function Mortgage() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const today = useToday();
  const qc = useQueryClient();
  const [pickingAccount, setPickingAccount] = useState(false);
  const [pickingHome, setPickingHome] = useState(false);
  const [adding, setAdding] = useState(false);
  const [graph, setGraph] = useState<'schedule' | 'year'>('schedule');
  const [tryExtra, setTryExtra] = useState(0);
  const [managing, setManaging] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const save = useMutation({
    mutationFn: (debt: DebtPlan) => api('PATCH', '/me/settings', { debt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const plan = me?.settings.debt ?? null;
  const period = periodOf(today);
  const live = useMemo(() => (accounts ?? []).filter((a) => !a.archivedAt), [accounts]);
  const loan = plan?.loans.find((l) => l.group === 'mortgage') ?? null;
  const account = loan ? live.find((a) => a.id === loan.accountId) : undefined;
  const owed = account ? owedCents(account.balanceCents) : 0;
  const current = plan ?? DEFAULT_DEBT_PLAN;
  // A manual balance doesn't move until the payment is applied; until then it's still ahead.
  const pending =
    !!loan && account?.source === 'manual' && isDue({ ...loan, owedCents: owed }, today);
  const view = useMemo(
    () => (loan && account ? mortgageView(loan, owed, current, period, pending) : null),
    [loan, account, owed, current, period, pending],
  );

  const header = {
    back: { label: 'Financial health', to: '/financial-health' },
    title: 'Mortgage',
  };
  if (!me || !accounts) {
    return <DetailPage header={header} shape={<Skeleton className="h-64 w-full" />} />;
  }

  const edit = (patch: Partial<DebtPlan>) => save.mutate({ ...current, ...patch });
  const editLoan = (patch: Partial<DebtLoanPlan>) =>
    loan &&
    edit({
      loans: current.loans.map((l) => (l.accountId === loan.accountId ? { ...l, ...patch } : l)),
    });
  const inPlan = new Set(current.loans.map((l) => l.accountId));
  const candidates = live
    .filter(
      (a) => !inPlan.has(a.id) && (a.kind === 'loan' || (a.kind === 'other' && a.balanceCents < 0)),
    )
    .map((a) => ({ id: a.id, name: a.name, owedCents: owedCents(a.balanceCents) }));
  const pickAccount = (id: string) => {
    const fresh: DebtLoanPlan = {
      accountId: id,
      group: 'mortgage',
      aprMilliPct: 0,
      paymentCents: 0,
      dueDay: 1,
      appliedThrough: period,
      merchant: '',
    };
    // Swapping accounts keeps the rate and payment already entered.
    edit({
      loans: [
        ...current.loans.filter((l) => l.group !== 'mortgage'),
        loan ? { ...loan, accountId: id } : fresh,
      ],
    });
  };
  const homeAccounts = live.filter((a) => a.balanceCents > 0 && a.kind !== 'depository');
  const homeValue = homeAccount(live, current.homeValueAccountId);
  const sheets = (
    <>
      <AccountSheet
        open={pickingAccount}
        onClose={() => setPickingAccount(false)}
        accounts={candidates}
        onPick={pickAccount}
      />
      <HomeValueSheet
        open={pickingHome}
        onClose={() => setPickingHome(false)}
        accounts={homeAccounts}
        selectedId={homeValue?.id ?? null}
        onPick={(id) => edit({ homeValueAccountId: id })}
      />
      <AddPaymentSheet
        key={addKey}
        open={adding}
        onClose={() => setAdding(false)}
        min={addMonths(period, 1)}
        onSave={(p, cents) =>
          edit({
            mortgageLumps: [...current.mortgageLumps, { period: p, cents }].sort((a, b) =>
              a.period.localeCompare(b.period),
            ),
          })
        }
      />
    </>
  );

  if (!loan || !account || !view) {
    return (
      <>
        <DetailPage
          header={header}
          identity={{ label: 'Mortgage', hero: <span className="text-ink-muted">Not set up</span> }}
          manage={
            <div className="py-3">
              <Button onClick={() => setPickingAccount(true)}>Choose account</Button>
            </div>
          }
        />
        {sheets}
      </>
    );
  }

  const lines = lineSeries(view.plan, owed);
  const first = view.plan.rows[0];
  const tries = [10_000, 25_000, 50_000, 100_000, ...(tryExtra > 0 ? [tryExtra] : [])]
    .sort((a, b) => a - b)
    .filter((x, i, all) => all.indexOf(x) === i)
    .map((extra) => ({
      extra,
      view: mortgageView(loan, owed, { ...current, mortgageExtraCents: extra }, period, pending),
    }));
  const equity = homeValue ? equityOf(homeValue.balanceCents, owed) : null;
  const labelAt = (m: number) =>
    monthName(addMonths(period, m - (pending ? 1 : 0))).replace(/^(\w{3})\w* /, '$1 ');
  const lastMonth = lines.months.at(-1) ?? 0;

  return (
    <>
      <DetailPage
        header={{
          ...header,
          action: (
            <IconButton icon="more" label="Mortgage settings" onClick={() => setManaging(true)} />
          ),
        }}
        identity={{
          label: 'Mortgage paid off',
          hero: view.payoffPeriod ? (
            <span className="money">{monthName(view.payoffPeriod)}</span>
          ) : (
            <span className="text-ink-muted">—</span>
          ),
          context: (
            <span className="money">
              {formatCents(owed, { whole: true })} owed
              {view.payoffPeriod
                ? ` · ${formatCents(view.plan.totalInterestCents, { whole: true })} interest to go`
                : ''}
            </span>
          ),
        }}
        shape={
          <>
            {view.estimated && (
              <p className="mb-4 text-clay money">
                {loan.paymentCents === 0
                  ? 'No payment entered.'
                  : `${formatCents(loan.paymentCents)} doesn't cover ${formatCents(first?.interestCents ?? 0)}/mo interest.`}{' '}
                Dates assume {formatCents(view.paymentCents)}/mo. Set payments left or the payment
                below.
              </p>
            )}
            {view.ytd && (
              <div className="mb-4">
                <Pill
                  label="Graph"
                  value={graph}
                  options={[
                    { id: 'schedule', label: 'Payoff schedule' },
                    { id: 'year', label: `${period.slice(0, 4)} so far` },
                  ]}
                  onChange={setGraph}
                />
              </div>
            )}
            {view.ytd && graph === 'year' ? (
              <div className="rounded-card bg-surface p-4 shadow-soft">
                <Donut principal={view.ytd.principalCents} interest={view.ytd.interestCents} />
              </div>
            ) : (
              lines.months.length > 2 && (
                <>
                  <Chart
                    kind="lines"
                    label="Balance, principal paid and interest paid over the life of the loan"
                    slots={lines.balance.length}
                    xLabels={[labelAt(0), labelAt(Math.round(lastMonth / 2)), labelAt(lastMonth)]}
                    lines={[
                      { label: 'Balance', values: lines.balance, color: series[0] },
                      { label: 'Principal to date', values: lines.principal, color: series[3] },
                      { label: 'Interest to date', values: lines.interest, color: series[2] },
                    ]}
                  />
                  <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-caption text-ink-muted">
                    <Legend color={series[0]} label="Balance" />
                    <Legend color={series[3]} label="Principal to date" />
                    <Legend color={series[2]} label="Interest to date" />
                  </ul>
                </>
              )
            )}
          </>
        }
        facts={
          <>
            <StaticRow label="Monthly payment" value={<MoneyText cents={view.paymentCents} />} />
            <StaticRow
              label="Payments left"
              value={<span className="money">{view.base.payoffMonth ?? '—'}</span>}
            />
            {view.monthsSooner !== null && view.interestSavedCents !== null && (
              <>
                <StaticRow
                  label="Sooner by"
                  value={`${view.monthsSooner} ${view.monthsSooner === 1 ? 'month' : 'months'}`}
                />
                <StaticRow
                  label="Interest saved"
                  value={<MoneyText cents={view.interestSavedCents} whole />}
                />
              </>
            )}
            {homeValue && (
              <StaticRow
                label="Home value"
                value={<MoneyText cents={homeValue.balanceCents} whole />}
              />
            )}
            {equity !== null && (
              <StaticRow
                label="Equity"
                value={
                  <span className="money">
                    <MoneyText cents={equity.cents} whole />
                    {equity.pct !== null && (
                      <span className="text-ink-muted"> · {equity.pct}%</span>
                    )}
                  </span>
                }
              />
            )}
          </>
        }
        related={[
          {
            title: 'Pay extra per month',
            children: (
              <div>
                <EditRow
                  label="Try an amount"
                  field={
                    <MoneyField label="Try an amount" cents={tryExtra} onCommit={setTryExtra} />
                  }
                />
                {tries.map((t) => (
                  <StaticRow
                    key={t.extra}
                    label={`+${formatCents(t.extra, { whole: true })}/mo`}
                    value={
                      <span className="money">
                        {t.view.payoffPeriod ? monthName(t.view.payoffPeriod) : '—'}
                        <span className="block type-caption text-ink-muted">
                          {t.view.monthsSooner !== null && t.view.interestSavedCents !== null
                            ? `${duration(t.view.monthsSooner)} sooner · saves ${formatCents(t.view.interestSavedCents, { whole: true })}`
                            : 'No change'}
                        </span>
                      </span>
                    }
                  />
                ))}
              </div>
            ),
          },
          {
            title: 'One-time payments',
            children: (
              <div>
                {current.mortgageLumps.map((l, i) => (
                  <div
                    key={`${l.period}-${i}`}
                    className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline py-2"
                  >
                    <span>
                      {monthName(l.period)} · <MoneyText cents={l.cents} whole />
                    </span>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        edit({ mortgageLumps: current.mortgageLumps.filter((_, j) => j !== i) })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="py-3">
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setAddKey((k) => k + 1);
                      setAdding(true);
                    }}
                  >
                    Add a one-time payment
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
      {sheets}
      <Sheet open={managing} title="Mortgage settings" onClose={() => setManaging(false)}>
        <div className="overflow-hidden rounded-card bg-surface px-4">
          <EditRow
            label="Rate"
            field={
              <NumberBox
                label="Rate"
                value={loan.aprMilliPct}
                parse={aprFromText}
                show={aprToText}
                suffix="%"
                onCommit={(n) => editLoan({ aprMilliPct: n })}
              />
            }
          />
          <EditRow
            label="Monthly payment"
            field={
              <MoneyField
                label="Monthly payment"
                cents={view.paymentCents}
                onCommit={(c) => editLoan({ paymentCents: c })}
              />
            }
          />
          <EditRow
            label="Payments left"
            field={
              <NumberBox
                label="Payments left"
                value={view.base.payoffMonth ?? 0}
                parse={parseLeft}
                show={showInt}
                width="w-12"
                onCommit={(n) =>
                  editLoan({ paymentCents: levelPayment(owed, loan.aprMilliPct, n) })
                }
              />
            }
          />
          <EditRow
            label="Term"
            field={
              <NumberBox
                label="Term in months"
                value={current.mortgageTermMonths}
                parse={parseInt1}
                show={showInt}
                suffix="mo"
                width="w-12"
                onCommit={(n) => edit({ mortgageTermMonths: n })}
              />
            }
          />
          <EditRow
            label="Extra per month"
            field={
              <MoneyField
                label="Extra per month"
                cents={current.mortgageExtraCents}
                onCommit={(c) => edit({ mortgageExtraCents: c })}
              />
            }
          />
          <ValueRow
            label="Home value"
            onClick={() => {
              setManaging(false);
              setPickingHome(true);
            }}
            muted={!homeValue}
          >
            {homeValue ? <MoneyText cents={homeValue.balanceCents} whole /> : 'Choose account'}
          </ValueRow>
          <ValueRow
            label="Account"
            onClick={() => {
              setManaging(false);
              setPickingAccount(true);
            }}
          >
            {account.name}
          </ValueRow>
        </div>
      </Sheet>
      {sheets}
    </>
  );
}
