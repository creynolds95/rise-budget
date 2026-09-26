import type { Transaction } from '@rise/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { CategoryPicker } from '../components/CategoryPicker';
import { RuleOfferSheet } from '../components/RuleOfferSheet';
import { TxnAmount } from '../components/TxnAmount';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { daysBetween, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { backFrom } from '../lib/nav';
import {
  useAccounts,
  useCategories,
  useInvalidateMoney,
  usePatchTransaction,
  useRecurring,
  useTransaction,
  useTransactions,
} from '../lib/queries';
import { splitProblem, withRemainder, type DraftSplit } from '../lib/splits';
import type { MerchantView, TransactionPage } from '../lib/types';

const CADENCES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annually' },
] as const;

const isAmazon = (m: string) => /AMAZON|AMZN/.test(m.toUpperCase());

/** T39. Five zones; categories, splits, notes, merchant name and transfer links edit here. */
export function TransactionDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const back = backFrom(params.get('from'));
  const txn = useTransaction(id);
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const patch = usePatchTransaction();
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [linking, setLinking] = useState(false);
  const [taggingWithdrawal, setTaggingWithdrawal] = useState(false);
  const [offer, setOffer] = useState<Parameters<typeof RuleOfferSheet>[0]['offer']>(null);
  const [error, setError] = useState<string | null>(null);
  const recurring = useRecurring();
  const splitting = params.get('split') === '1';
  const setSplitting = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set('split', '1');
        else p.delete('split');
        return p;
      },
      { replace: true },
    );

  const t = txn.data;
  const merchant = useQuery({
    queryKey: ['merchant', t?.merchantNormalized],
    queryFn: () =>
      get<MerchantView>(`/merchants/${encodeURIComponent(t?.merchantNormalized ?? '')}`),
    enabled: !!t,
  });
  const same = useTransactions({ q: t?.merchantNormalized ?? '' });

  if (!t) {
    return (
      <DetailPage
        header={{ back, title: '' }}
        identity={{
          label: txn.isError ? 'Not found' : 'Transaction',
          hero: txn.isError ? '—' : <Skeleton className="h-11 w-40" />,
        }}
      />
    );
  }

  const catName = (cid: string) => {
    const c = categories.find((x) => x.id === cid);
    if (!c) return 'Unknown';
    return c.emoji ? `${c.emoji} ${c.name}` : c.name;
  };
  const account = accounts.find((a) => a.id === t.accountId);
  const name = t.merchantDisplay ?? t.merchantNormalized;
  const income = t.amountCents < 0;
  const withdrawalRule = recurring.data?.find(
    (s) => s.source === 'manual' && s.merchantNormalized === t.merchantNormalized,
  );
  const refresh = async () => {
    await invalidate();
    await Promise.all(
      ['review-queue', 'queue-count', 'merchant', 'recurring'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  };
  const save = async (body: Parameters<typeof patch.mutateAsync>[0]) => {
    setError(null);
    try {
      const res = await patch.mutateAsync(body);
      if (res.ruleOffer) setOffer(res.ruleOffer);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };
  const fileAs = (categoryId: string) => save({ id, categoryId, reviewState: 'reviewed' });
  const top = (merchant.data?.topCategoryIds ?? []).filter((c) =>
    categories.some((x) => x.id === c),
  );
  const needsCategory = !t.isTransfer && t.splits.length === 0;
  const amazon = isAmazon(t.merchantNormalized);
  const others = (same.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (x) => x.id !== id && x.merchantNormalized === t.merchantNormalized,
  );

  return (
    <>
      <DetailPage
        header={{ back, title: name }}
        identity={{
          label: t.isTransfer ? 'Transfer' : income ? 'Money in' : 'Spent',
          hero: <TxnAmount t={t} />,
          context: (
            <>
              {shortDate(t.postedAt)} · {account?.name ?? 'Unknown account'}
              {t.isPending && ' · Pending'}
              {t.reviewState === 'needs_review' && ' · To review'}
              {t.reviewState === 'dropped' && ' · Never posted'}
            </>
          ),
        }}
        shape={
          needsCategory && (amazon || top.length > 0) ? (
            <div className="flex flex-wrap gap-2">
              {top.map((c) => (
                <button
                  key={c}
                  onClick={() => void fileAs(c)}
                  className="min-h-11 rounded-full border border-hairline bg-surface px-4"
                >
                  {catName(c)}
                </button>
              ))}
              {amazon && (
                <Button className="rounded-full" onClick={() => setSplitting(true)}>
                  Split this order
                </Button>
              )}
            </div>
          ) : undefined
        }
        facts={
          <>
            {t.isTransfer ? (
              <StaticRow label="Category" value="Transfer, not spending" />
            ) : t.splits.length > 1 ? (
              t.splits.map((s) => (
                <StaticRow
                  key={s.id}
                  label={catName(s.categoryId)}
                  value={<MoneyText cents={s.amountCents} />}
                />
              ))
            ) : (
              <EditRow
                label="Category"
                field={
                  <button
                    className="min-h-11 rounded-input border border-hairline bg-surface px-3"
                    onClick={() => setPicking(true)}
                  >
                    {t.splits[0] ? catName(t.splits[0].categoryId) : 'Choose…'}
                  </button>
                }
              />
            )}
            <EditRow
              label="Merchant"
              field={
                <button
                  className="min-h-11 max-w-48 truncate rounded-input border border-hairline bg-surface px-3"
                  onClick={() => setRenaming(true)}
                >
                  {name}
                </button>
              }
            />
            <EditRow
              label="Notes"
              field={<NotesField value={t.notes} onCommit={(notes) => void save({ id, notes })} />}
            />
            <StaticRow
              label="Account"
              value={
                <span className="max-w-56 break-words text-right">{account?.name ?? '—'}</span>
              }
            />
            <StaticRow label="Date" value={shortDate(t.postedAt)} />
            <StaticRow
              label="Bank description"
              value={<span className="break-all type-caption">{t.descriptorRaw}</span>}
            />
            {error && <p className="py-2 text-clay">{error}</p>}
          </>
        }
        related={
          others.length > 0
            ? {
                title: `Other ${name}`,
                children: others
                  .slice(0, 5)
                  .map((o) => <TxnRow key={o.id} t={o} from={`${name}|/transactions/${id}`} />),
              }
            : undefined
        }
        manage={
          <div className="-ml-4 flex flex-col items-start">
            {!t.isTransfer && (
              <Button variant="quiet" onClick={() => setSplitting(true)}>
                {t.splits.length > 1 ? 'Edit split' : 'Split transaction'}
              </Button>
            )}
            {t.reviewState === 'needs_review' && !t.isTransfer && (
              <Button variant="quiet" onClick={() => void save({ id, reviewState: 'reviewed' })}>
                Mark reviewed
              </Button>
            )}
            {t.reviewState === 'reviewed' && (
              <Button
                variant="quiet"
                onClick={() => void save({ id, reviewState: 'needs_review' })}
              >
                Send back to review
              </Button>
            )}
            {t.isTransfer ? (
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await api('DELETE', `/transactions/${id}/transfer-link`);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'Could not unlink.');
                  }
                }}
              >
                {t.transferPairId ? 'Not a transfer — unlink both sides' : 'Not a transfer'}
              </Button>
            ) : (
              <Button variant="quiet" onClick={() => setLinking(true)}>
                Link as a transfer…
              </Button>
            )}
            {!t.isTransfer &&
              (withdrawalRule ? (
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await api('DELETE', `/transactions/${id}/recurring-cash-withdrawal`);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Could not untag.');
                    }
                  }}
                >
                  Untag recurring {income ? 'paycheck' : 'cash withdrawal'}
                </Button>
              ) : (
                <Button variant="quiet" onClick={() => setTaggingWithdrawal(true)}>
                  Recurring {income ? 'paycheck' : 'cash withdrawal'}…
                </Button>
              ))}
          </div>
        }
      />
      <CategoryPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setPicking(false);
          void fileAs(c);
        }}
      />
      {splitting && (
        <SplitSheet
          t={t}
          onClose={() => setSplitting(false)}
          onSaved={async () => {
            setSplitting(false);
            await refresh();
          }}
        />
      )}
      <RenameSheet
        open={renaming}
        merchant={t.merchantNormalized}
        current={merchant.data?.displayName ?? null}
        onClose={() => setRenaming(false)}
        onSaved={refresh}
      />
      {linking && <LinkTransferSheet t={t} onClose={() => setLinking(false)} onLinked={refresh} />}
      {taggingWithdrawal && (
        <RecurringWithdrawalSheet
          t={t}
          income={income}
          onClose={() => setTaggingWithdrawal(false)}
          onSaved={refresh}
        />
      )}
      <RuleOfferSheet offer={offer} onClose={() => setOffer(null)} />
    </>
  );
}

function NotesField({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <input
      aria-label="Notes"
      className="min-h-11 w-48 rounded-input border border-hairline bg-surface px-3 focus:border-sage-600 focus:outline-none"
      value={text}
      placeholder="Add a note"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() || null;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

/** SPEC §3.5: typed rows plus an auto-computed last row, so the set always sums exactly. */
function SplitSheet({
  t,
  onClose,
  onSaved,
}: {
  t: Transaction;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const groups = useCategories().data ?? [];
  const initial =
    t.splits.length > 1
      ? t.splits
      : [
          { categoryId: t.splits[0]?.categoryId ?? '', amountCents: t.amountCents },
          { categoryId: '', amountCents: 0 },
        ];
  const [typed, setTyped] = useState<DraftSplit[]>(
    initial.slice(0, -1).map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents })),
  );
  const [last, setLast] = useState(initial.at(-1)?.categoryId ?? '');
  const [error, setError] = useState<string | null>(null);
  const rows = withRemainder(t.amountCents, typed, last);
  const problem = splitProblem(t.amountCents, rows);
  const select = 'min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-surface px-2';
  const options = (
    <>
      <option value="">Category…</option>
      {groups.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
  const message = {
    missing_category: 'Choose a category for every row.',
    zero_row: 'Remove rows with no amount.',
    remainder_flips_sign: `The rows add up to more than ${formatCents(Math.abs(t.amountCents))}.`,
  } as const;
  return (
    <Sheet open title={`Split ${formatCents(Math.abs(t.amountCents))}`} onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {typed.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <select
              aria-label={`Category ${i + 1}`}
              className={select}
              value={s.categoryId}
              onChange={(e) =>
                setTyped(typed.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))
              }
            >
              {options}
            </select>
            <MoneyField
              label={`Amount ${i + 1}`}
              cents={Math.abs(s.amountCents)}
              onCommit={(v) =>
                setTyped(
                  typed.map((x, j) =>
                    j === i ? { ...x, amountCents: t.amountCents < 0 ? -v : v } : x,
                  ),
                )
              }
            />
            <button
              aria-label={`Remove row ${i + 1}`}
              className="min-h-11 min-w-11 text-ink-muted"
              onClick={() => setTyped(typed.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <select
            aria-label="Category for the rest"
            className={select}
            value={last}
            onChange={(e) => setLast(e.target.value)}
          >
            {options}
          </select>
          <span
            className="flex min-h-11 w-32 items-center justify-end px-3"
            title="The rest, worked out for you"
          >
            <MoneyText
              cents={Math.abs(rows.at(-1)?.amountCents ?? 0)}
              tone={problem === 'remainder_flips_sign' ? 'over' : 'muted'}
            />
          </span>
          <span className="min-w-11" />
        </li>
      </ul>
      <Button
        variant="quiet"
        className="-ml-4 mt-2"
        onClick={() => setTyped([...typed, { categoryId: '', amountCents: 0 }])}
      >
        Add a row
      </Button>
      {(problem ?? error) && (
        <p className="mt-2 text-clay">{error ?? (problem ? message[problem] : '')}</p>
      )}
      <Button
        className="mt-4 w-full"
        disabled={problem !== null}
        onClick={async () => {
          try {
            await api('POST', `/transactions/${t.id}/splits`, { splits: rows });
            if (t.reviewState === 'needs_review')
              await api('PATCH', `/transactions/${t.id}`, { reviewState: 'reviewed' });
            await onSaved();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not save the split.');
          }
        }}
      >
        Save split
      </Button>
    </Sheet>
  );
}

/** Renaming a merchant renames every past and future transaction from it. */
function RenameSheet({
  open,
  merchant,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  merchant: string;
  current: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(current ?? ''), [current, open]);
  const submit = async (displayName: string | null) => {
    try {
      await api('PATCH', `/merchants/${encodeURIComponent(merchant)}`, { displayName });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not rename.');
    }
  };
  return (
    <Sheet open={open} title="Rename merchant" onClose={onClose}>
      <p className="text-ink-muted">
        Every transaction from {merchant}, past and future, shows this name.
      </p>
      <input
        aria-label="Merchant name"
        className="mt-4 min-h-11 w-full rounded-input border border-hairline bg-surface px-3"
        value={text}
        placeholder={merchant}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={!text.trim()}
        onClick={() => void submit(text.trim())}
      >
        Rename
      </Button>
      {current && (
        <Button variant="quiet" className="mt-2 w-full" onClick={() => void submit(null)}>
          Go back to {merchant}
        </Button>
      )}
    </Sheet>
  );
}

/**
 * Caleb's "Recurring Cash Withdrawal" tag, and the same for a paycheck: a real cash auto-draft
 * (a specific student loan, a mortgage) or income (a semimonthly paycheck) too new or too
 * easily confused with a sibling for auto-detection to find on its own. The amount comes from
 * this transaction, never typed in. Feeds the cash-to-payday tool only — it doesn't touch this
 * transaction's category or create another transaction.
 */
function RecurringWithdrawalSheet({
  t,
  income,
  onClose,
  onSaved,
}: {
  t: Transaction;
  income: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]['value']>(
    income ? 'semimonthly' : 'monthly',
  );
  const [dueDate, setDueDate] = useState(t.postedAt);
  const [anchorDay1, setAnchorDay1] = useState(5);
  const [anchorDay2, setAnchorDay2] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open
      title={income ? 'Recurring paycheck' : 'Recurring cash withdrawal'}
      onClose={onClose}
    >
      <p className="text-ink-muted">
        Plan for this {income ? 'paycheck to arrive' : 'cash to leave your account'} again, on a
        schedule — for the cash-to-payday tool only. It won't change this transaction's category.
      </p>
      <label className="mt-4 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Repeats</span>
        <select
          aria-label="Repeats"
          className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as (typeof CADENCES)[number]['value'])}
        >
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {cadence === 'semimonthly' ? (
        <div className="mt-3 flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="type-caption text-ink-muted">First day of month</span>
            <input
              type="number"
              aria-label="First day of month"
              min={1}
              max={31}
              value={anchorDay1}
              onChange={(e) => setAnchorDay1(Number(e.target.value))}
              className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="type-caption text-ink-muted">Second day of month</span>
            <input
              type="number"
              aria-label="Second day of month"
              min={1}
              max={31}
              value={anchorDay2}
              onChange={(e) => setAnchorDay2(Number(e.target.value))}
              className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
            />
          </label>
        </div>
      ) : (
        <label className="mt-3 flex flex-col gap-1">
          <span className="type-caption text-ink-muted">Due date</span>
          <input
            type="date"
            aria-label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
          />
        </label>
      )}
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api('POST', `/transactions/${t.id}/recurring-cash-withdrawal`, {
              cadence,
              dueDate,
              anchorDays: cadence === 'semimonthly' ? [anchorDay1, anchorDay2] : undefined,
            });
            await onSaved();
            onClose();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not save.');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Sheet>
  );
}

/** Candidates: equal and opposite, another account, within 4 days, not already paired (SPEC §3.3). */
function LinkTransferSheet({
  t,
  onClose,
  onLinked,
}: {
  t: Transaction;
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const accounts = useAccounts().data ?? [];
  const [error, setError] = useState<string | null>(null);
  const around = (d: number) =>
    new Date(Date.parse(`${t.postedAt}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  const nearby = useQuery({
    queryKey: ['txns', 'transfer-candidates', t.id],
    queryFn: () => get<TransactionPage>(`/transactions?from=${around(-4)}&to=${around(4)}`),
  });
  const candidates = (nearby.data?.items ?? []).filter(
    (o) =>
      o.accountId !== t.accountId &&
      o.amountCents === -t.amountCents &&
      !o.transferPairId &&
      Math.abs(daysBetween(t.postedAt, o.postedAt)) <= 4,
  );
  return (
    <Sheet open title="Link as a transfer" onClose={onClose}>
      <p className="text-ink-muted">
        Pick the other side. Both stop counting as spending or income.
      </p>
      {nearby.isPending && <Skeleton className="mt-4 h-12 w-full" />}
      {nearby.data && candidates.length === 0 && (
        <p className="mt-4">
          No matching {formatCents(Math.abs(t.amountCents))} in another account within 4 days.
        </p>
      )}
      <ul className="mt-2">
        {candidates.map((o) => (
          <li key={o.id}>
            <button
              className="flex min-h-12 w-full items-center justify-between border-b border-hairline text-left active:bg-sage-100"
              onClick={async () => {
                try {
                  await api('POST', `/transactions/${t.id}/transfer-link`, { otherTxnId: o.id });
                  await onLinked();
                  onClose();
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Could not link.');
                }
              }}
            >
              <span>
                {accounts.find((a) => a.id === o.accountId)?.name}
                <span className="block type-caption text-ink-faint">
                  {shortDate(o.postedAt)} · {o.merchantDisplay ?? o.merchantNormalized}
                </span>
              </span>
              <MoneyText cents={-o.amountCents} sign="always" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="quiet"
        className="-ml-4 mt-4"
        onClick={async () => {
          try {
            await api('POST', `/transactions/${t.id}/mark-transfer`);
            await onLinked();
            onClose();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not mark.');
          }
        }}
      >
        The other side isn't here yet — mark as a transfer
      </Button>
      {error && <p className="mt-2 text-clay">{error}</p>}
    </Sheet>
  );
}
