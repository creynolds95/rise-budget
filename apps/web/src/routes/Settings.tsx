import type {
  Category,
  CategoryGroupKind,
  Rule,
  RuleMatchField,
  RuleMatchType,
} from '@rise/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { AddCategorySheet } from '../components/AddCategorySheet';
import { CategoryEditSheet } from '../components/CategoryEditSheet';
import { Group, GroupRow, RadioRow } from '../components/primitives/Group';
import { Toggle } from '../components/primitives/Toggle';
import { backFrom } from '../lib/nav';
import { CategoryPicker } from '../components/CategoryPicker';
import { Button } from '../components/primitives/Button';
import { Chevron } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { localToday, shortDate } from '../lib/dates';
import {
  useAccounts,
  useCategories,
  useGroups,
  useInvalidateMoney,
  useMe,
  useRules,
  useSyncStatus,
} from '../lib/queries';

const SECTIONS = {
  budget: 'Budget settings',
  categories: 'Categories',
  rules: 'Rules',
  sync: 'Bank sync',
  security: 'Sign-in',
} as const;
type Section = keyof typeof SECTIONS;

const MODE = {
  live: 'Connected to SimpleFIN',
  mock: 'Using sample data',
  off: 'Not connected yet',
} as const;

/** T43. Not a stock grouped list: each area is a card that says its current state. */
export function Settings() {
  const me = useMe().data;
  const { signOut } = useAuth();
  const rules = useRules().data;
  const categories = useCategories().data;
  const accounts = useAccounts().data;
  const sync = useSyncStatus().data;
  const lastRun = sync?.runs[0];

  return (
    <div className="gutter mx-auto max-w-2xl pt-4 pb-12">
      <h1 className="type-title">{me?.displayName ?? 'Settings'}</h1>
      <p className="text-ink-muted">{me?.email}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card to="/settings/sync" title="Bank sync" state={sync ? MODE[sync.mode] : undefined}>
          {lastRun
            ? `Last run ${shortDate(localToday(me?.timezone, new Date(lastRun.startedAt)))} · ${lastRun.status}`
            : 'No runs yet'}
        </Card>
        <Card
          to="/settings/budget"
          title="Budget"
          state={
            me
              ? me.settings.planChangesApplyToFuture
                ? 'Plans carry to future months'
                : 'Plans change one month at a time'
              : undefined
          }
        >
          How plan changes and month end work
        </Card>
        <Card
          to="/settings/categories"
          title="Categories"
          state={categories ? `${categories.length} in use` : undefined}
        >
          Groups, names, bills and income
        </Card>
        <Card
          to="/settings/rules"
          title="Rules"
          state={rules ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}` : undefined}
        >
          What files itself automatically
        </Card>
        <Card
          to="/accounts"
          title="Accounts"
          state={accounts ? `${accounts.filter((a) => !a.archivedAt).length} accounts` : undefined}
        >
          Balances, cadence, loans
        </Card>
        <Card to="/settings/security" title="Sign-in" state="Passkeys">
          Add this device or another
        </Card>
      </div>

      <Button variant="quiet" className="-ml-4 mt-8" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}

function Card({
  to,
  title,
  state,
  children,
}: {
  to: string;
  title: string;
  state?: string | undefined;
  children: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-24 items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-soft active:bg-sage-100"
    >
      <span>
        <span className="type-label text-ink-muted">{title}</span>
        <span className="mt-1 block font-semibold">
          {state ?? <Skeleton className="h-5 w-24" />}
        </span>
        <span className="block type-caption text-ink-faint">{children}</span>
      </span>
      <Chevron />
    </Link>
  );
}

export function SettingsSection() {
  const { section = '' } = useParams();
  const [params] = useSearchParams();
  if (!(section in SECTIONS)) return <Navigate to="/settings" replace />;
  const s = section as Section;
  const back = backFrom(params.get('from'), { label: 'Settings', to: '/settings' });
  return (
    <div className="mx-auto max-w-2xl pb-16">
      <header className="gutter sticky top-[var(--banner-h,0px)] z-10 grid min-h-14 grid-cols-[1fr_auto_1fr] items-center bg-canvas/95 backdrop-blur">
        <Link
          to={back.to}
          className="flex min-h-11 items-center gap-1 justify-self-start text-sage-700"
        >
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
        <h1 className="type-body font-semibold">{SECTIONS[s]}</h1>
        <span />
      </header>
      <div className="gutter pt-4">
        {s === 'budget' && <BudgetSection />}
        {s === 'categories' && <CategoriesSection />}
        {s === 'rules' && <RulesSection />}
        {s === 'sync' && <SyncSection />}
        {s === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

/** Monarch-style budget preferences, minus what Rise's model makes moot. */
function BudgetSection() {
  const me = useMe().data;
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (b: { planChangesApplyToFuture?: boolean; rollIncomeVariance?: boolean }) =>
      api('PATCH', '/me/settings', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const future = me?.settings.planChangesApplyToFuture ?? false;
  return (
    <>
      <Group
        title="When you change a plan"
        footer="You can still pick either one each time, in the plan editor. Months that are already over never change."
      >
        <RadioRow
          name="plan-scope"
          label="This month only"
          hint="An edit changes the month you're looking at."
          checked={!future}
          onSelect={() => patch.mutate({ planChangesApplyToFuture: false })}
        />
        <RadioRow
          name="plan-scope"
          label="All future months"
          hint="An edit also becomes the plan for every month after it."
          checked={future}
          onSelect={() => patch.mutate({ planChangesApplyToFuture: true })}
        />
      </Group>
      <Group title="Month end">
        <GroupRow
          label="Carry income differences"
          hint="When pay comes in above or below what you expected, the difference moves next month's Ready to assign."
        >
          <Toggle
            label="Carry income differences"
            on={me?.settings.rollIncomeVariance ?? true}
            onChange={(v) => patch.mutate({ rollIncomeVariance: v })}
          />
        </GroupRow>
      </Group>
      <Group title="Categories">
        <Link
          to="/settings/categories?from=Budget settings|/settings/budget"
          className="flex min-h-13 items-center justify-between px-4 py-3 active:bg-sage-100"
        >
          <span>Categories and groups</span>
          <Chevron />
        </Link>
      </Group>
      <Group title="How Rise budgets">
        <ol className="space-y-3 px-4 py-4 text-ink-muted">
          <li>
            <span className="font-medium text-ink">Every dollar gets a job.</span> Income lands in
            Ready to assign; you hand it to categories.
          </li>
          <li>
            <span className="font-medium text-ink">Leftovers roll.</span> Unspent money stays in its
            category next month, unless you send it back.
          </li>
          <li>
            <span className="font-medium text-ink">Going over is a debt, not a failure.</span>{' '}
            Overspending carries into next month so it gets paid back.
          </li>
        </ol>
      </Group>
    </>
  );
}

function CategoriesSection() {
  const groups = useGroups().data ?? [];
  const categories = useCategories().data ?? [];
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [newGroup, setNewGroup] = useState<{ name: string; kind: CategoryGroupKind } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['groups'] })]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };
  const input = 'min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-surface px-3';
  return (
    <>
      <p className="text-ink-muted">
        Income groups hold paychecks and are never budgeted. Expense groups are what you plan and
        spend.
      </p>
      {error && <p className="mt-2 text-clay">{error}</p>}
      {groups.map((g) => (
        <section key={g.id} className="mt-6">
          <h2 className="type-label text-ink-muted">
            {g.name} · {g.kind === 'income' ? 'Income' : 'Expense'}
          </h2>
          <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
            {categories
              .filter((c) => c.groupId === g.id)
              .map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setEditing(c)}
                    className="flex min-h-13 w-full items-center gap-3 px-4 py-3 text-left active:bg-sage-100"
                  >
                    <span aria-hidden className="w-7 text-center text-xl leading-none">
                      {c.emoji ?? '·'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}</span>
                      {g.kind === 'expense' && (
                        <span className="block type-caption text-ink-faint">
                          {c.rolloverPolicy === 'roll' ? 'Leftover carries' : 'Leftover returns'}
                          {c.spendShape === 'fixed' ? ' · like a bill' : ''}
                        </span>
                      )}
                    </span>
                    <Chevron />
                  </button>
                </li>
              ))}
          </ul>
          {g.kind === 'income' && <IncomeCategoryAdd groupId={g.id} onSave={save} />}
        </section>
      ))}
      <div className="mt-6 flex flex-col items-start">
        <Button variant="quiet" className="-ml-4" onClick={() => setAdding(true)}>
          Add an expense category
        </Button>
        <Button
          variant="quiet"
          className="-ml-4"
          onClick={() => setNewGroup({ name: '', kind: 'income' })}
        >
          Add a group
        </Button>
      </div>
      <AddCategorySheet open={adding} groups={groups} onClose={() => setAdding(false)} />
      <CategoryEditSheet category={editing} groups={groups} onClose={() => setEditing(null)} />
      <Sheet open={newGroup !== null} title="New group" onClose={() => setNewGroup(null)}>
        {newGroup && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save(() =>
                api('POST', '/category-groups', {
                  name: newGroup.name.trim(),
                  kind: newGroup.kind,
                }),
              ).then(() => setNewGroup(null));
            }}
          >
            <input
              aria-label="Group name"
              className={input}
              value={newGroup.name}
              onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              placeholder="Paychecks"
              required
            />
            <select
              aria-label="Kind"
              className={input}
              value={newGroup.kind}
              onChange={(e) =>
                setNewGroup({ ...newGroup, kind: e.target.value as CategoryGroupKind })
              }
            >
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <Button type="submit">Add group</Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

function IncomeCategoryAdd({
  groupId,
  onSave,
}: {
  groupId: string;
  onSave: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(() => api('POST', '/categories', { groupId, name: name.trim() })).then(() =>
          setName(''),
        );
      }}
    >
      <input
        aria-label="New income category"
        className="min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-surface px-3"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Paycheck"
      />
      <Button type="submit" variant="quiet" disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}

const FIELD: Record<RuleMatchField, string> = {
  merchant: 'Merchant',
  descriptor: 'Bank description',
};
const TYPE: Record<RuleMatchType, string> = {
  equals: 'is',
  contains: 'contains',
  regex: 'matches pattern',
};

/** Rules are viewable, editable, deletable (T43). Editing replaces the rule. */
function RulesSection() {
  const rules = useRules();
  const categories = useCategories().data ?? [];
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Unknown';
  const refresh = () =>
    Promise.all(
      ['rules', 'review-queue', 'queue-count'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  return (
    <>
      <p className="text-ink-muted">
        A rule files matching transactions automatically, ahead of any guess. Rise only makes one
        when you say yes.
      </p>
      {error && <p className="mt-2 text-clay">{error}</p>}
      {rules.isPending && <Skeleton className="mt-4 h-12 w-full" />}
      {rules.data?.length === 0 && (
        <p className="mt-6">
          No rules yet. After you file the same merchant the same way three times, Rise will offer
          one.
        </p>
      )}
      <ul className="mt-4">
        {rules.data?.map((r) => (
          <li
            key={r.id}
            className="flex min-h-14 items-center justify-between gap-2 border-b border-hairline py-2"
          >
            <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
              <span className="block truncate">
                {FIELD[r.matchField]} {TYPE[r.matchType]}{' '}
                <strong className="font-semibold">{r.matchValue}</strong>
              </span>
              <span className="block type-caption text-ink-faint">→ {catName(r.categoryId)}</span>
            </button>
            <Button
              variant="danger"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete the rule for ${r.matchValue}? Past transactions keep their categories.`,
                  )
                )
                  return;
                try {
                  await api('DELETE', `/rules/${r.id}`);
                  await refresh();
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Could not delete.');
                }
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" className="-ml-4 mt-4" onClick={() => setEditing('new')}>
        Add a rule
      </Button>
      {editing && (
        <RuleSheet
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

function RuleSheet({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const categories = useCategories().data ?? [];
  const [field, setField] = useState<RuleMatchField>(rule?.matchField ?? 'merchant');
  const [type, setType] = useState<RuleMatchType>(rule?.matchType ?? 'equals');
  const [value, setValue] = useState(rule?.matchValue ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = 'min-h-11 w-full rounded-input border border-hairline bg-surface px-3';
  return (
    <Sheet open title={rule ? 'Edit rule' : 'New rule'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            // Create first, so a rejected edit leaves the old rule in place.
            await api('POST', '/rules', {
              matchField: field,
              matchType: type,
              matchValue: value.trim(),
              categoryId,
              priority: rule?.priority ?? 0,
            });
            if (rule) await api('DELETE', `/rules/${rule.id}`);
            await onSaved();
            onClose();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save.');
          }
        }}
      >
        <div className="flex gap-2">
          <select
            aria-label="Match on"
            className={input}
            value={field}
            onChange={(e) => setField(e.target.value as RuleMatchField)}
          >
            {Object.entries(FIELD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="Match type"
            className={input}
            value={type}
            onChange={(e) => setType(e.target.value as RuleMatchType)}
          >
            {Object.entries(TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <input
          aria-label="Match value"
          className={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="QUIKTRIP"
          required
        />
        <button type="button" className={`${input} text-left`} onClick={() => setPicking(true)}>
          {categories.find((c) => c.id === categoryId)?.name ?? 'Choose a category…'}
        </button>
        {error && <p className="text-clay">{error}</p>}
        <Button type="submit" disabled={!value.trim() || !categoryId}>
          Save rule
        </Button>
      </form>
      <CategoryPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setCategoryId(id);
          setPicking(false);
        }}
      />
    </Sheet>
  );
}

function SyncSection() {
  const status = useSyncStatus();
  const tz = useMe().data?.timezone;
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api('POST', '/sync/run', {}),
    onSuccess: () =>
      Promise.all([
        invalidate(),
        ...['sync', 'review-queue', 'queue-count'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      ]),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Sync failed.'),
  });
  const mode = status.data?.mode;
  return (
    <>
      <p className="type-label text-ink-muted">Status</p>
      <p className="mt-1 font-semibold">{mode ? MODE[mode] : '…'}</p>
      <p className="mt-1 text-ink-muted">
        {mode === 'off'
          ? 'Rise will pull from your banks three times a day once SimpleFIN is connected. It can only read; it can never move money.'
          : 'Rise syncs automatically three times a day. It can only read; it can never move money.'}
      </p>
      {mode !== 'off' && (
        <Button className="mt-4" disabled={run.isPending || !mode} onClick={() => run.mutate()}>
          {run.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      )}
      {error && <p className="mt-2 text-clay">{error}</p>}
      <h2 className="mt-8 type-label text-ink-muted">Recent runs</h2>
      {status.data?.runs.length === 0 && <p className="mt-2 text-ink-muted">None yet.</p>}
      <ul className="mt-1">
        {status.data?.runs.slice(0, 20).map((r) => (
          <li key={r.id} className="border-b border-hairline py-2">
            <span className="flex justify-between">
              <span>
                {shortDate(localToday(tz, new Date(r.startedAt)))} ·{' '}
                {new Date(r.startedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  ...(tz ? { timeZone: tz } : {}),
                })}
              </span>
              <span className={r.status === 'ok' ? 'text-ink-muted' : 'text-clay'}>{r.status}</span>
            </span>
            <span className="block type-caption text-ink-faint">
              {r.rowsInserted} new · {r.rowsUpdated} updated · {r.accountsTouched} accounts
            </span>
            {r.errors.map((e, i) => (
              <span key={i} className="block type-caption text-clay">
                {e.message}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function SecuritySection() {
  const { registerPasskey, signOut } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <p className="text-ink-muted">
        Rise signs in with passkeys: Face ID, Touch ID or a security key. Add one for each device
        you use.
      </p>
      <Button
        className="mt-4"
        onClick={async () => {
          setMsg(null);
          try {
            await registerPasskey();
            setMsg('Passkey added.');
          } catch (e) {
            setMsg(e instanceof ApiError ? e.message : 'Passkey was not added.');
          }
        }}
      >
        Add a passkey on this device
      </Button>
      {msg && <p className="mt-2 text-ink-muted">{msg}</p>}
      <Button variant="quiet" className="-ml-4 mt-8" onClick={() => void signOut()}>
        Sign out
      </Button>
    </>
  );
}
