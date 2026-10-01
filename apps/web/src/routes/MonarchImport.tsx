import {
  parseMonarchCsv,
  planMonarchImport,
  possibleDuplicates,
  toImportRows,
  type AccountChoice,
  type CategoryChoice,
  type CategoryKind,
  type GuessedAccountKind,
} from '@rise/shared/import';
import { MONARCH_WINDOW, type MonarchBatch, type MonarchRowsResult } from '@rise/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Chevron } from '../components/primitives/Rows';
import { Button } from '../components/primitives/Button';
import { Group, GroupRow } from '../components/primitives/Group';
import { MoneyText } from '../components/primitives/MoneyText';
import { api, get } from '../lib/api';
import { shortDate } from '../lib/dates';
import {
  ACCOUNT_KINDS,
  CATEGORY_KINDS,
  chunk,
  duplicateKey,
  needGroup,
  resolveIds,
  setupBody,
  skippedIds,
  withoutSkipped,
} from '../lib/monarchImport';
import { useAccounts, useCategories, useGroups, useInvalidateMoney } from '../lib/queries';

const SELECT = 'min-h-11 max-w-[60%] rounded-input border border-hairline bg-surface px-2';

type Progress = { done: number; total: number };

/** One-time history import from a Monarch Transactions export. Nothing is written until Confirm. */
export function MonarchImport() {
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const groups = useGroups().data ?? [];
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ReturnType<typeof parseMonarchCsv> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountChoices, setAccountChoices] = useState<Record<string, AccountChoice>>({});
  const [categoryChoices, setCategoryChoices] = useState<Record<string, CategoryChoice>>({});
  const [categoryGroups, setCategoryGroups] = useState<Record<string, string>>({});
  const [skipGroups, setSkipGroups] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<MonarchRowsResult | null>(null);

  const plan = useMemo(
    () =>
      parsed
        ? planMonarchImport(
            parsed.rows,
            accounts.map((a) => ({ id: a.id, name: a.name })),
            categories.map((c) => ({ id: c.id, name: c.name })),
            MONARCH_WINDOW,
          )
        : null,
    [parsed, accounts, categories],
  );
  const dupes = useMemo(() => (plan ? possibleDuplicates(plan.rows) : []), [plan]);

  const batches = useQuery({
    queryKey: ['monarch-batches'],
    queryFn: () => get<MonarchBatch[]>('/import/monarch/batches'),
  });
  const undo = useMutation({
    mutationFn: (id: string) => api<null>('DELETE', `/import/monarch/batches/${id}`),
    onSuccess: async () => {
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['monarch-batches'] })]);
    },
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setParsed(parseMonarchCsv(await file.text()));
      setAccountChoices({});
      setCategoryChoices({});
      setCategoryGroups({});
      setSkipGroups(new Set());
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    }
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const created = await api<{
        accounts: Record<string, string>;
        categories: Record<string, string>;
      }>(
        'POST',
        '/import/monarch/setup',
        setupBody(plan.accounts, plan.categories, accountChoices, categoryChoices, categoryGroups),
      );
      const accountIds = resolveIds(plan.accounts, accountChoices, created.accounts);
      const categoryIds = resolveIds(plan.categories, categoryChoices, created.categories);
      const { rows } = toImportRows(plan.rows, accountIds, categoryIds);
      const send = withoutSkipped(rows, skippedIds(dupes, skipGroups));
      const batchId = crypto.randomUUID();
      const total: MonarchRowsResult = { imported: 0, duplicate: 0, overlap: 0, rejected: 0 };
      setProgress({ done: 0, total: send.length });
      let done = 0;
      for (const part of chunk(send)) {
        const r = await api<MonarchRowsResult>('POST', '/import/monarch/rows', {
          batchId,
          rows: part,
        });
        total.imported += r.imported;
        total.duplicate += r.duplicate;
        total.overlap += r.overlap;
        total.rejected += r.rejected;
        done += part.length;
        setProgress({ done, total: send.length });
      }
      return total;
    },
    onSuccess: async (total) => {
      setResult(total ?? null);
      setParsed(null);
      setProgress(null);
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['monarch-batches'] })]);
    },
    onError: () => setProgress(null),
  });

  const unmatched = plan?.categories.filter((c) => !c.matched) ?? [];
  const matched = plan?.categories.filter((c) => c.matched) ?? [];
  const ungrouped = plan ? needGroup(plan.categories, categoryChoices, categoryGroups) : [];
  const busy = run.isPending;
  const extras = skippedIds(dupes, skipGroups).size;
  const accountsNew =
    plan?.accounts.filter((a) => (accountChoices[a.monarchName] ?? a.choice).type === 'create')
      .length ?? 0;
  const accountsMerged = (plan?.accounts.length ?? 0) - accountsNew;

  return (
    <>
      <Group title="Import from Monarch">
        <div className="px-4 py-3">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            variant="quiet"
            className="-ml-4"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {parsed ? 'Choose a different file' : 'Choose Transactions CSV'}
          </Button>
          <p className="type-caption text-ink-faint">
            {shortDate(MONARCH_WINDOW.from)} – {shortDate(MONARCH_WINDOW.to)} · history only
          </p>
        </div>
      </Group>
      {error && <p className="mt-2 px-1 text-clay">{error}</p>}
      {run.isError && (
        <p className="mt-2 px-1 text-clay">
          Stopped part-way: {(run.error as Error).message} Run it again — rows already in are
          skipped.
        </p>
      )}
      {result && (
        <Group title="Imported">
          <GroupRow label="Added">
            <span className="money">{result.imported}</span>
          </GroupRow>
          {result.duplicate > 0 && (
            <GroupRow label="Already there">
              <span className="money">{result.duplicate}</span>
            </GroupRow>
          )}
          {result.overlap > 0 && (
            <GroupRow label="Already in your bank feed">
              <span className="money">{result.overlap}</span>
            </GroupRow>
          )}
          {result.rejected > 0 && (
            <GroupRow label="Left out (outside dates)">
              <span className="money">{result.rejected}</span>
            </GroupRow>
          )}
        </Group>
      )}

      {plan && parsed && (
        <>
          <Group>
            <GroupRow label="Transactions">
              <span className="money">{plan.rows.length - extras}</span>
            </GroupRow>
            {unmatched.length > 0 && (
              <Fold label="New categories" summary={`${unmatched.length} to add or match`} start>
                {unmatched.map((p) => (
                  <CategoryChoiceRow
                    key={p.monarchName}
                    name={p.monarchName}
                    rows={p.rows}
                    choice={categoryChoices[p.monarchName] ?? p.choice}
                    onChange={(c) => setCategoryChoices((s) => ({ ...s, [p.monarchName]: c }))}
                    groupId={categoryGroups[p.monarchName] ?? ''}
                    onGroup={(g) => setCategoryGroups((s) => ({ ...s, [p.monarchName]: g }))}
                    cats={categories}
                    groups={groups}
                  />
                ))}
              </Fold>
            )}
            {dupes.length > 0 && (
              <Fold
                label="Possible duplicates"
                summary={extras ? `${extras} skipped` : `${dupes.length}, all kept`}
                start
              >
                {dupes.map((g) => {
                  const k = duplicateKey(g);
                  return (
                    <label key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate">
                          {g.merchant} · {g.sourceIds.length}×
                        </span>
                        <span className="type-caption text-ink-muted">
                          {shortDate(g.postedAt)} · {g.account}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <MoneyText cents={g.amountCents} />
                        <input
                          type="checkbox"
                          aria-label={`Skip extras of ${g.merchant} on ${g.postedAt}`}
                          className="size-5"
                          checked={skipGroups.has(k)}
                          onChange={(e) =>
                            setSkipGroups((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(k);
                              else n.delete(k);
                              return n;
                            })
                          }
                        />
                      </span>
                    </label>
                  );
                })}
              </Fold>
            )}
            <Fold label="Accounts and categories" summary="Automatic">
              <Fold
                label="Accounts"
                summary={`${accountsNew} history-only${accountsMerged ? `, ${accountsMerged} merged` : ''}`}
              >
                {plan.accounts.map((a) => {
                  const c = accountChoices[a.monarchName] ?? a.choice;
                  const value = c.type === 'existing' ? `acct:${c.accountId}` : `new:${c.kind}`;
                  return (
                    <div
                      key={a.monarchName}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{a.monarchName}</span>
                        <span className="type-caption text-ink-muted money">
                          {a.rows} · {shortDate(a.first)} – {shortDate(a.last)}
                        </span>
                      </span>
                      <select
                        aria-label={`Account for ${a.monarchName}`}
                        className={SELECT}
                        value={value}
                        onChange={(e) => {
                          const [t, v] = e.target.value.split(':') as [string, string];
                          setAccountChoices((s) => ({
                            ...s,
                            [a.monarchName]:
                              t === 'acct'
                                ? { type: 'existing', accountId: v }
                                : { type: 'create', kind: v as GuessedAccountKind },
                          }));
                        }}
                      >
                        <optgroup label="Past account (history only)">
                          {Object.entries(ACCOUNT_KINDS).map(([k, label]) => (
                            <option key={k} value={`new:${k}`}>
                              {label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Merge into">
                          {accounts.map((x) => (
                            <option key={x.id} value={`acct:${x.id}`}>
                              {x.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  );
                })}
              </Fold>
              <Fold label="Categories" summary={`${matched.length} matched`}>
                {matched.map((p) => (
                  <CategoryChoiceRow
                    key={p.monarchName}
                    name={p.monarchName}
                    rows={p.rows}
                    choice={categoryChoices[p.monarchName] ?? p.choice}
                    onChange={(c) => setCategoryChoices((s) => ({ ...s, [p.monarchName]: c }))}
                    groupId={categoryGroups[p.monarchName] ?? ''}
                    onGroup={(g) => setCategoryGroups((s) => ({ ...s, [p.monarchName]: g }))}
                    cats={categories}
                    groups={groups}
                  />
                ))}
              </Fold>
            </Fold>
            {parsed.errors.length > 0 && (
              <GroupRow
                label="Unreadable rows"
                hint={parsed.errors
                  .slice(0, 2)
                  .map((e) => `Line ${e.line}: ${e.message}`)
                  .join(' · ')}
              >
                <span className="money text-ink-muted">{parsed.errors.length}</span>
              </GroupRow>
            )}
          </Group>

          <Button
            className="mt-6 w-full"
            disabled={busy || plan.rows.length === 0 || ungrouped.length > 0}
            onClick={() => run.mutate()}
          >
            {busy && progress
              ? `Importing ${progress.done} / ${progress.total}…`
              : ungrouped.length > 0
                ? `Choose a group for ${ungrouped.length} new categor${ungrouped.length === 1 ? 'y' : 'ies'}`
                : 'Import'}
          </Button>
        </>
      )}

      {(batches.data?.length ?? 0) > 0 && (
        <Group title="Past imports">
          {batches.data?.map((b) => (
            <div key={b.batchId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block money">{b.rows} transactions</span>
                <span className="type-caption text-ink-muted money">
                  {shortDate(b.from)} – {shortDate(b.to)}
                </span>
              </span>
              <Button
                variant="danger"
                disabled={undo.isPending}
                onClick={() => {
                  if (window.confirm(`Remove these ${b.rows} imported transactions?`))
                    undo.mutate(b.batchId);
                }}
              >
                Undo
              </Button>
            </div>
          ))}
        </Group>
      )}
    </>
  );
}

/** A summary row that opens to its detail; closed unless it needs a decision. */
function Fold({
  label,
  summary,
  start = false,
  children,
}: {
  label: string;
  summary: string;
  start?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(start);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-13 w-full items-center justify-between gap-4 px-4 py-3 text-left active:bg-sage-100"
      >
        <span>{label}</span>
        <span className="flex items-center gap-2 text-ink-muted">
          {summary}
          <Chevron />
        </span>
      </button>
      {open && <div className="divide-y divide-hairline border-t border-hairline">{children}</div>}
    </div>
  );
}

function CategoryChoiceRow({
  name,
  rows,
  choice,
  onChange,
  cats,
  groups,
  groupId = '',
  onGroup,
}: {
  name: string;
  rows: number;
  choice: CategoryChoice;
  onChange: (c: CategoryChoice) => void;
  cats: { id: string; name: string; groupId: string }[];
  groups: { id: string; name: string; kind: string }[];
  groupId?: string;
  onGroup?: (groupId: string) => void;
}) {
  const value = choice.type === 'existing' ? `cat:${choice.categoryId}` : `new:${choice.kind}`;
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        <span className="type-caption text-ink-muted money">{rows}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
        <select
          aria-label={`Category for ${name}`}
          className={SELECT}
          value={value}
          onChange={(e) => {
            const [t, v] = e.target.value.split(':') as [string, string];
            onChange(
              t === 'cat'
                ? { type: 'existing', categoryId: v }
                : { type: 'create', kind: v as CategoryKind },
            );
          }}
        >
          <optgroup label="Add category">
            {Object.entries(CATEGORY_KINDS).map(([k, label]) => (
              <option key={k} value={`new:${k}`}>
                Add as new · {label}
              </option>
            ))}
          </optgroup>
          {groups.map((g) => {
            const inGroup = cats.filter((c) => c.groupId === g.id);
            if (inGroup.length === 0) return null;
            return (
              <optgroup key={g.id} label={g.name}>
                {inGroup.map((c) => (
                  <option key={c.id} value={`cat:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {choice.type === 'create' && choice.kind !== 'transfer' && onGroup && (
          <select
            aria-label={`Group for ${name}`}
            className={SELECT}
            value={groupId}
            onChange={(e) => onGroup(e.target.value)}
          >
            <option value="" disabled>
              Choose a group
            </option>
            {groups
              .filter((g) => g.kind === (choice.kind === 'income' ? 'income' : 'expense'))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        )}
      </div>
    </div>
  );
}
