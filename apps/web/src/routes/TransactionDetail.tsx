import { surplusMatch, type Cadence } from '@rise/shared/recurring';
import type { Transaction } from '@rise/shared/schemas';
import { merchantName } from '../lib/merchant';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { CategoryPicker } from '../components/CategoryPicker';
import { RuleOfferSheet } from '../components/RuleOfferSheet';
import { RuleSheet } from '../components/RuleSheet';
import { ScheduleFields } from '../components/ScheduleFields';
import { TxnAmount } from '../components/TxnAmount';
import { TxnRow } from '../components/TxnRow';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { Menu } from '../components/primitives/Menu';
import { ValueRow } from '../components/primitives/Rows';
import { navigateWithTransition } from '../lib/transition';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, get } from '../lib/api';
import { daysBetween, longDate, shortDate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { backFrom } from '../lib/nav';
import {
  useAccounts,
  useCashToPayday,
  useCategories,
  useInvalidateMoney,
  usePatchTransaction,
  useRecurring,
  useTransaction,
  useTransactions,
} from '../lib/queries';
import { draftFrom, schedulePayload, type ScheduleDraft } from '../lib/schedule';
import { splitProblem, withRemainder, type DraftSplit } from '../lib/splits';
import type { MerchantView, TransactionPage } from '../lib/types';

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
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);
  const [taggingWithdrawal, setTaggingWithdrawal] = useState(false);
  const [ruling, setRuling] = useState(false);
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
  const surplus = useCashToPayday();
  // A transfer's other leg says whether it is a card payment, which Surplus never counts.
  const pair = useQuery({
    queryKey: ['txn', t?.transferPairId],
    queryFn: () => get<Transaction>(`/transactions/${t?.transferPairId}`),
    enabled: !!t?.transferPairId,
  });

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
  const name = merchantName(t);
  const income = t.amountCents < 0;
  const withdrawalRule = recurring.data?.find(
    (s) => s.source === 'manual' && s.merchantNormalized === t.merchantNormalized,
  );
  // Only the cash accounts carry the row: anywhere else Surplus never counts anything.
  const inSurplus =
    surplus.data?.cashAccounts.some((a) => a.id === t.accountId) && (!t.transferPairId || pair.data)
      ? surplusMatch(
          {
            merchant: t.merchantNormalized,
            amountCents: t.amountCents,
            date: t.postedAt,
            accountId: t.accountId,
            isTransfer: t.isTransfer,
            pairAccountId: pair.data?.accountId ?? null,
          },
          surplus.data.schedules.map((s) => ({
            merchant: s.merchant,
            name: s.displayName,
            amountCents: s.kind === 'income' ? -s.amountCents : s.amountCents,
            cadence: s.cadence as Cadence,
            anchorDays: s.anchorDays,
            nextExpectedDate: s.nextExpectedDate,
            isHandAdded: s.isHandAdded,
          })),
          new Map(surplus.data.suggestions.map((s) => [s.merchant, s.displayName])),
          new Set(surplus.data.cashAccounts.map((a) => a.id)),
          new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id)),
        )
      : null;
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
        header={{
          back,
          title: name,
          action: (
            <Menu
              label="Transaction options"
              items={[
                ...(!t.isTransfer
                  ? [
                      {
                        label: t.splits.length > 1 ? 'Edit split' : 'Split transaction',
                        icon: 'sliders' as const,
                        onSelect: () => setSplitting(true),
                      },
                    ]
                  : []),
                ...(t.reviewState === 'needs_review' && !t.isTransfer
                  ? [
                      {
                        label: 'Mark reviewed',
                        icon: 'check' as const,
                        onSelect: () => void save({ id, reviewState: 'reviewed' }),
                      },
                    ]
                  : []),
                ...(t.reviewState === 'reviewed'
                  ? [
                      {
                        label: 'Send back to review',
                        icon: 'refresh' as const,
                        onSelect: () => void save({ id, reviewState: 'needs_review' }),
                      },
                    ]
                  : []),
                t.isTransfer
                  ? {
                      label: t.transferPairId ? 'Not a transfer (unlink both)' : 'Not a transfer',
                      icon: 'flow' as const,
                      onSelect: async () => {
                        try {
                          await api('DELETE', `/transactions/${id}/transfer-link`);
                          await refresh();
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : 'Could not unlink.');
                        }
                      },
                    }
                  : {
                      label: 'Link as a transfer',
                      icon: 'flow' as const,
                      onSelect: () => setLinking(true),
                    },
                ...(!t.isTransfer
                  ? [
                      withdrawalRule
                        ? {
                            label: `Untag recurring ${income ? 'paycheck' : 'cash withdrawal'}`,
                            icon: 'refresh' as const,
                            onSelect: async () => {
                              try {
                                await api(
                                  'DELETE',
                                  `/transactions/${id}/recurring-cash-withdrawal`,
                                );
                                await refresh();
                              } catch (e) {
                                setError(e instanceof ApiError ? e.message : 'Could not untag.');
                              }
                            },
                          }
                        : {
                            label: `Recurring ${income ? 'paycheck' : 'cash withdrawal'}`,
                            icon: 'refresh' as const,
                            onSelect: () => setTaggingWithdrawal(true),
                          },
                    ]
                  : []),
                {
                  label: merchant.data?.rule ? 'Edit rule' : 'Create rule',
                  icon: 'filter' as const,
                  onSelect: () => setRuling(true),
                },
                {
                  label: 'Delete transaction',
                  icon: 'trash' as const,
                  onSelect: () => setDeleting(true),
                },
              ]}
            />
          ),
        }}
        identity={{
          label: t.isTransfer ? 'Transfer' : income ? 'Money in' : 'Spent',
          hero: <TxnAmount t={t} />,
          context:
            t.isPending || t.reviewState === 'needs_review' || t.reviewState === 'dropped' ? (
              <span className="inline-flex items-center rounded-full bg-sage-100 px-3 py-0.5 type-caption font-medium text-ink-muted">
                {t.reviewState === 'dropped'
                  ? 'Never posted'
                  : t.isPending
                    ? 'Pending'
                    : 'To review'}
              </span>
            ) : undefined,
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
            <ValueRow label="Merchant" onClick={() => setRenaming(true)}>
              {name}
            </ValueRow>
            <ValueRow label="Original statement" muted>
              <span className="break-all">{t.descriptorRaw}</span>
            </ValueRow>
            <ValueRow label="Account">{account?.name ?? '—'}</ValueRow>
            {t.isTransfer ? (
              <ValueRow label="Category" muted>
                Transfer, not spending
              </ValueRow>
            ) : t.splits.length > 1 ? (
              t.splits.map((s) => (
                <ValueRow
                  key={s.id}
                  label={catName(s.categoryId)}
                  onClick={() => setSplitting(true)}
                >
                  <MoneyText cents={s.amountCents} />
                </ValueRow>
              ))
            ) : (
              <ValueRow label="Category" onClick={() => setPicking(true)}>
                {t.splits[0] ? catName(t.splits[0].categoryId) : 'Choose…'}
              </ValueRow>
            )}
            <label className="relative block">
              <ValueRow label="Date" onClick={() => {}}>
                {longDate(t.postedAt)}
              </ValueRow>
              <input
                type="date"
                aria-label="Date"
                value={t.postedAt}
                onChange={(e) => e.target.value && void save({ id, postedAt: e.target.value })}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
            {inSurplus &&
              (inSurplus.state === 'untracked' ? (
                <ValueRow label="Surplus" muted>
                  Not tracked
                </ValueRow>
              ) : (
                <ValueRow
                  label="Surplus"
                  onClick={() => navigateWithTransition(navigate, '/cash-to-payday', 'forward')}
                >
                  {inSurplus.state === 'tracked'
                    ? inSurplus.name
                    : inSurplus.state === 'likely'
                      ? `Likely ${inSurplus.name}`
                      : 'Suggested, not added'}
                </ValueRow>
              ))}
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <span className="shrink-0 text-ink-muted">Notes</span>
              <NotesField value={t.notes} onCommit={(notes) => void save({ id, notes })} />
            </div>
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
      />
      <Sheet open={deleting} title="Delete transaction?" onClose={() => setDeleting(false)}>
        <p className="text-ink-muted">
          {t.source === 'manual'
            ? 'It is removed from your spending and every total it counted toward. This can’t be undone.'
            : 'It is removed from your spending and every total it counted toward, and the next bank sync won’t bring it back. This can’t be undone.'}
        </p>
        {error && <p className="mt-2 text-clay">{error}</p>}
        <Button
          variant="danger"
          className="mt-4 w-full"
          onClick={async () => {
            try {
              await api('DELETE', `/transactions/${id}`);
              setDeleting(false);
              await refresh();
              navigateWithTransition(navigate, back.to, 'back');
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not delete.');
            }
          }}
        >
          Delete transaction
        </Button>
        <Button variant="quiet" className="mt-2 w-full" onClick={() => setDeleting(false)}>
          Keep it
        </Button>
      </Sheet>
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
      {ruling && (
        <RuleSheet
          rule={merchant.data?.rule ?? null}
          initial={{
            matchField: 'merchant',
            matchType: 'equals',
            matchValue: t.merchantNormalized,
            categoryId: t.splits.length === 1 ? (t.splits[0]?.categoryId ?? '') : '',
          }}
          onClose={() => setRuling(false)}
          onSaved={() =>
            Promise.all(
              ['rules', 'review-queue', 'queue-count', 'merchant'].map((k) =>
                qc.invalidateQueries({ queryKey: [k] }),
              ),
            )
          }
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
      className="min-h-11 min-w-0 flex-1 bg-transparent text-right placeholder:text-ink-faint focus:outline-none"
      value={text}
      placeholder="Add notes…"
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
  const categories = useCategories().data ?? [];
  // A new split starts as one amount to type plus the rest (C12), not a full row and an empty one.
  const initial =
    t.splits.length > 1
      ? t.splits
      : [
          { categoryId: t.splits[0]?.categoryId ?? '', amountCents: 0 },
          { categoryId: '', amountCents: t.amountCents },
        ];
  const [typed, setTyped] = useState<DraftSplit[]>(
    initial.slice(0, -1).map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents })),
  );
  const [last, setLast] = useState(initial.at(-1)?.categoryId ?? '');
  const [picking, setPicking] = useState<number | 'last' | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = withRemainder(t.amountCents, typed, last);
  const problem = splitProblem(t.amountCents, rows);
  const label = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : 'Category…';
  };
  const pickButton = (id: string, which: number | 'last', aria: string) => (
    <button
      type="button"
      aria-label={aria}
      onClick={() => setPicking(which)}
      className={`min-h-11 min-w-0 flex-1 truncate rounded-input border border-hairline bg-surface px-3 text-left ${id ? '' : 'text-ink-muted'}`}
    >
      {label(id)}
    </button>
  );
  const message = {
    missing_category: 'Choose a category for every row.',
    zero_row: 'Remove rows with no amount.',
    remainder_flips_sign: `The rows add up to more than ${formatCents(Math.abs(t.amountCents))}.`,
  } as const;
  // Say what's wrong once there's something to be wrong about — overshooting always shows.
  const shown =
    error ?? (problem && (touched || problem === 'remainder_flips_sign') ? message[problem] : null);
  return (
    <Sheet open title={`Split ${formatCents(Math.abs(t.amountCents))}`} onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {typed.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            {pickButton(s.categoryId, i, `Category ${i + 1}`)}
            <MoneyField
              label={`Amount ${i + 1}`}
              cents={Math.abs(s.amountCents)}
              onCommit={(v) => {
                setTouched(true);
                setTyped(
                  typed.map((x, j) =>
                    j === i ? { ...x, amountCents: t.amountCents < 0 ? -v : v } : x,
                  ),
                );
              }}
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
          {pickButton(last, 'last', 'Category for the rest')}
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
      {shown && <p className="mt-2 text-clay">{shown}</p>}
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
      <CategoryPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(id) => {
          setTouched(true);
          if (picking === 'last') setLast(id);
          else if (picking !== null)
            setTyped(typed.map((x, j) => (j === picking ? { ...x, categoryId: id } : x)));
          setPicking(null);
        }}
      />
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
      // Close on success; the screen catching up behind it needn't hold the prompt open.
      onClose();
      await onSaved();
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
  const [draft, setDraft] = useState<ScheduleDraft>(() => ({
    ...draftFrom(income ? 'semimonthly' : 'monthly', null, t.postedAt, { day1: 1, day2: 15 }),
  }));
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
      <ScheduleFields draft={draft} onChange={setDraft} dateLabel="Due date" />
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            const { anchorDate, ...rest } = schedulePayload(draft);
            await api('POST', `/transactions/${t.id}/recurring-cash-withdrawal`, {
              ...rest,
              dueDate: anchorDate,
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
                  {shortDate(o.postedAt)} · {merchantName(o)}
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
