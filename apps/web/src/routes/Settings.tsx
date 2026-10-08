import { isTransfersGroup } from '@rise/shared/categorize';
import type {
  AlertSettings,
  PushSettings,
  AppLock,
  Category,
  CategoryGroup,
  CategoryGroupKind,
  Rule,
} from '@rise/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BackLink } from '../components/BackLink';
import { GroupHeading, IconBadge, PageHeader } from '../components/PageHeader';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { AddCategorySheet } from '../components/AddCategorySheet';
import { CategoryEditSheet } from '../components/CategoryEditSheet';
import { Group, GroupRow, RadioRow } from '../components/primitives/Group';
import { backFrom } from '../lib/nav';
import { useSwipeBack } from '../lib/gestures';
import { transitionClick } from '../lib/transition';
import { passkeyMessage } from '../lib/passkey';
import { clearPin, hasPin, lockKeys, setPin, store as lockStore, validPin } from '../lib/lock';
import { getThemeSetting, setThemeSetting, type ThemeSetting } from '../lib/theme';
import { RULE_FIELD as FIELD, RULE_TYPE as TYPE, RuleSheet } from '../components/RuleSheet';
import { Button } from '../components/primitives/Button';
import { Chevron } from '../components/primitives/Rows';
import { Icon, IconButton, type IconName } from '../components/primitives/Icon';
import { Menu } from '../components/primitives/Menu';
import { Leaving, Sheet } from '../components/primitives/Sheet';
import { Sortable } from '../components/primitives/Sortable';
import { Toggle } from '../components/primitives/Toggle';
import { Skeleton } from '../components/primitives/Skeleton';
import { ApiError, api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { banksLastReported, syncOutcome, type SyncRunResult } from '../lib/syncOutcome';
import { localToday, shortDate } from '../lib/dates';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import { isStale, RUNNING, updateApp, useLatestBuild } from '../lib/version';
import {
  useAccounts,
  useBackupStatus,
  useUsage,
  useCategories,
  useDevices,
  useGroups,
  useInvalidateMoney,
  useMe,
  useRules,
  useSyncStatus,
} from '../lib/queries';

// Heavy, rarely opened sections load on first visit (precached for offline all the same).
const Investments = lazy(() => import('./Investments').then((m) => ({ default: m.Investments })));
const MonarchImport = lazy(() =>
  import('./MonarchImport').then((m) => ({ default: m.MonarchImport })),
);
const Reports = lazy(() => import('./Reports').then((m) => ({ default: m.Reports })));
const TagsSection = lazy(() => import('./Tags').then((m) => ({ default: m.TagsSection })));

const SECTIONS = {
  appearance: 'Appearance',
  budget: 'Budget settings',
  alerts: 'Alerts',
  categories: 'Categories',
  investments: 'Investments',
  reports: 'Reports',
  rules: 'Rules',
  tags: 'Tags',
  sync: 'Bank sync',
  security: 'Security',
  data: 'Your data',
} as const;
type Section = keyof typeof SECTIONS;

const MODE = {
  live: 'Connected to SimpleFIN',
  mock: 'Using sample data',
  off: 'Not connected yet',
} as const;

/**
 * T43. Not a stock grouped list, and not a card per area either (DESIGN-SYSTEM §3): an index
 * where each area leads with its current state, grouped by hairlines and type alone.
 */
const THEME_LABEL: Record<ThemeSetting, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export function Settings() {
  const me = useMe().data;
  const { signOut } = useAuth();
  const rules = useRules().data;
  const categories = useCategories().data;
  const accounts = useAccounts().data;
  const sync = useSyncStatus().data;
  const lastRun = sync?.runs[0];
  const backups = useBackupStatus().data;
  const appearance = getThemeSetting();

  const syncTone =
    lastRun?.status === 'failed'
      ? 'text-clay-text'
      : lastRun?.status === 'partial'
        ? 'text-gold-text'
        : sync?.mode === 'live'
          ? 'text-sage-700'
          : '';
  return (
    <div className="mx-auto max-w-2xl pb-12">
      <PageHeader title={me?.displayName ?? 'Settings'} subtitle={me?.email} />
      <div className="gutter">
        <GroupHeading>Data</GroupHeading>
        <ul className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          <Card
            to="/settings/sync"
            icon="refresh"
            title="Bank sync"
            state={sync ? MODE[sync.mode] : undefined}
            tone={syncTone}
          >
            {lastRun
              ? `Last run ${shortDate(localToday(me?.timezone, new Date(lastRun.startedAt)))} · ${lastRun.status}`
              : 'No runs yet'}
          </Card>
          <Card
            to="/accounts"
            icon="wallet"
            title="Accounts"
            state={
              accounts ? `${accounts.filter((a) => !a.archivedAt).length} accounts` : undefined
            }
          />
          <Card
            to="/settings/investments"
            icon="chart"
            title="Investments"
            state="Portfolio vs S&P 500"
          />
          <Card to="/settings/reports" icon="flow" title="Reports" state="Cash flow and spending" />
          <Card
            to="/settings/data"
            icon="doc"
            title="Your data"
            state={
              backups
                ? backups.latest
                  ? `Backed up ${shortDate(backups.latest.date)}`
                  : 'No backup yet'
                : undefined
            }
          />
        </ul>

        <GroupHeading>Budget</GroupHeading>
        <ul className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          <Card
            to="/settings/budget"
            icon="sliders"
            title="Budget"
            state={
              me
                ? me.settings.planChangesApplyToFuture
                  ? 'Plans carry forward'
                  : 'One month at a time'
                : undefined
            }
          />
          <Card
            to="/settings/categories"
            icon="grid"
            title="Categories"
            state={categories ? `${categories.length} in use` : undefined}
          />
          <Card
            to="/settings/rules"
            icon="filter"
            title="Rules"
            state={rules ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}` : undefined}
          />
        </ul>

        <GroupHeading>Preferences</GroupHeading>
        <ul className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
          <Card
            to="/settings/alerts"
            icon="bell"
            title="Alerts"
            state={
              me
                ? `${Object.values(me.settings.alerts).filter(Boolean).length} of ${ALERT_ROWS.length} on`
                : undefined
            }
          />
          <Card
            to="/settings/appearance"
            icon="sun"
            title="Appearance"
            state={THEME_LABEL[appearance]}
          />
          <Card
            to="/settings/security"
            icon="lock"
            title="Security"
            state={
              me
                ? me.settings.appLock === 'off'
                  ? 'App lock off'
                  : `Locks ${{ immediate: 'immediately', '5m': 'after 5 min', '1h': 'after 1 hour' }[me.settings.appLock]}`
                : undefined
            }
          />
        </ul>

        <Button variant="quiet" className="-ml-4 mt-8" onClick={() => void signOut()}>
          Sign out
        </Button>
        {/* Which build is running, so a deploy that never went out is visible (C20). */}
        <AppVersion timeZone={me?.timezone} />
      </div>
    </div>
  );
}

function AppVersion({ timeZone }: { timeZone: string | undefined }) {
  const latest = useLatestBuild();
  const [updating, setUpdating] = useState(false);
  const built = new Date(RUNNING.version).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  const stale = latest !== null && isStale(RUNNING, latest);
  return (
    <div className="mt-6 flex min-h-11 items-center justify-between gap-4">
      <p className="type-caption text-ink-muted money">
        Version {RUNNING.commit} · {built}
        <br />
        {stale ? (
          <span className="text-ink">Update available</span>
        ) : (
          latest && <span className="text-ink-faint">Latest</span>
        )}
      </p>
      {stale && (
        <Button
          className="shrink-0"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            void updateApp();
          }}
        >
          {updating ? 'Updating…' : 'Update'}
        </Button>
      )}
    </div>
  );
}

function Card({
  to,
  title,
  icon,
  state,
  tone = '',
  children,
}: {
  to: string;
  title: string;
  icon: IconName;
  state?: string | undefined;
  tone?: string;
  children?: string;
}) {
  const navigate = useNavigate();
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="flex min-h-16 items-center gap-3 py-3 active:bg-sage-100"
      >
        <IconBadge>
          <Icon name={icon} size={18} />
        </IconBadge>
        <span className="min-w-0 flex-1">
          <span className="block type-label text-ink-muted">{title}</span>
          <span className={`block truncate font-medium ${tone}`}>
            {state ?? <Skeleton className="h-5 w-24" />}
          </span>
          {children && <span className="block type-caption text-ink-faint">{children}</span>}
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

export function SettingsSection() {
  const { section = '' } = useParams();
  const [params] = useSearchParams();
  const backTo = backFrom(params.get('from'), { label: 'Settings', to: '/settings' }).to;
  useSwipeBack(backTo);
  if (!(section in SECTIONS)) return <Navigate to="/settings" replace />;
  const s = section as Section;
  const back = backFrom(params.get('from'), { label: 'Settings', to: '/settings' });
  return (
    <div className="mx-auto max-w-2xl pb-16">
      <header className="gutter sticky top-[var(--banner-h,0px)] z-10 grid grid-cols-[1fr_auto_1fr] items-center banner bg-banner text-banner-ink shadow-soft">
        <BackLink to={back.to} label={back.label} />
        <h1 className="type-body font-semibold">{SECTIONS[s]}</h1>
        <span id="settings-action" className="justify-self-end" />
      </header>
      <Suspense fallback={<SectionFallback />}>
        {s === 'reports' && <Reports />}
        {s === 'investments' && (
          <div className="gutter pt-4">
            <Investments />
          </div>
        )}
        <div className="gutter pt-4">
          {s === 'appearance' && <AppearanceSection />}
          {s === 'budget' && <BudgetSection />}
          {s === 'alerts' && <AlertsSection />}
          {s === 'categories' && <CategoriesSection />}
          {s === 'rules' && <RulesSection />}
          {s === 'tags' && <TagsSection />}
          {s === 'sync' && <SyncSection />}
          {s === 'security' && <SecuritySection />}
          {s === 'data' && <DataSection />}
        </div>
      </Suspense>
    </div>
  );
}

function SectionFallback() {
  return (
    <div className="gutter pt-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

const THEME_CHOICES: { id: ThemeSetting; label: string; hint?: string }[] = [
  { id: 'system', label: 'Match system', hint: 'Follows your phone or computer’s setting.' },
  { id: 'light', label: 'Light', hint: 'Always light, regardless of the system.' },
  { id: 'dark', label: 'Dark', hint: 'Always dark, regardless of the system.' },
];

function AppearanceSection() {
  const [setting, setSetting] = useState<ThemeSetting>(getThemeSetting());
  return (
    <Group title="Theme">
      {THEME_CHOICES.map((c) => (
        <RadioRow
          key={c.id}
          name="theme"
          label={c.label}
          hint={c.hint}
          checked={setting === c.id}
          onSelect={() => {
            setThemeSetting(c.id);
            setSetting(c.id);
          }}
        />
      ))}
    </Group>
  );
}

/** Monarch-style budget preferences, minus what Rise's model makes moot. */
function BudgetSection() {
  const me = useMe().data;
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (b: { planChangesApplyToFuture?: boolean }) => api('PATCH', '/me/settings', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const future = me?.settings.planChangesApplyToFuture ?? false;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Carry where Budget settings itself was opened from, so back from Categories retraces the path.
  const own = params.get('from');
  const categoriesHref = `/settings/categories?from=${encodeURIComponent(
    `Budget settings|/settings/budget${own ? `?from=${encodeURIComponent(own)}` : ''}`,
  )}`;
  return (
    <>
      <Group title="When you change a plan">
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
      <Group title="Categories">
        <Link
          to={categoriesHref}
          onClick={transitionClick(navigate, categoriesHref)}
          className="flex min-h-13 items-center justify-between px-4 py-3 active:bg-sage-100"
        >
          <span>Categories and groups</span>
          <Chevron />
        </Link>
      </Group>
    </>
  );
}

const ALERT_ROWS: { key: keyof AlertSettings; label: string; hint: string }[] = [
  { key: 'priceUp', label: 'Price went up', hint: 'A recurring charge costs more than last time' },
  {
    key: 'doubleCharge',
    label: 'Charged twice',
    hint: 'A recurring charge landed twice in one cycle',
  },
  {
    key: 'duplicate',
    label: 'Possible duplicate',
    hint: 'Same amount, same place, within two days',
  },
  { key: 'unusual', label: 'More than usual', hint: 'Well above what this place usually charges' },
  { key: 'firstTime', label: 'Large first charge', hint: '$300 or more somewhere new' },
];

/** Which quiet notices show (SPEC §8.1), and which also push to a device (SPEC §8.2). */
function AlertsSection() {
  const me = useMe().data;
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (alerts: AlertSettings) => api('PATCH', '/me/settings', { alerts }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  if (!me) return null;
  const alerts = me.settings.alerts;
  return (
    <>
      <Group title="Show me">
        {ALERT_ROWS.map((r) => (
          <GroupRow key={r.key} label={r.label} hint={r.hint}>
            <Toggle
              label={r.label}
              on={alerts[r.key]}
              disabled={patch.isPending}
              onChange={(on) => patch.mutate({ ...alerts, [r.key]: on })}
            />
          </GroupRow>
        ))}
      </Group>
      <PushGroup push={me.settings.push} />
    </>
  );
}

const PUSH_ROWS: { key: keyof PushSettings; label: string }[] = [
  { key: 'recap', label: 'Weekly recap' },
  { key: 'missedBill', label: 'Bill didn’t charge' },
  { key: 'bankTrouble', label: 'Bank sync needs a look' },
  ...ALERT_ROWS.map(({ key, label }) => ({ key, label })),
  { key: 'surplusNegative', label: 'Surplus going negative' },
  { key: 'toReview', label: 'Transactions to review' },
];

function PushGroup({ push }: { push: PushSettings }) {
  const qc = useQueryClient();
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (support !== 'ok') return;
    void currentSubscription()
      .then((s) => setOn(s !== null))
      .catch(() => setOn(false));
  }, [support]);
  const patch = useMutation({
    mutationFn: (p: PushSettings) => api('PATCH', '/me/settings', { push: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const flip = async (want: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (want) {
        const ok = await enablePush();
        if (!ok) setNote('Notifications are blocked for Rise in this device’s settings.');
        setOn(ok);
      } else {
        await disablePush();
        setOn(false);
      }
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Couldn’t change notifications.');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setNote(null);
    try {
      await api('POST', '/push/test');
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'The test didn’t send.');
    }
  };
  return (
    <>
      <Group
        title="Push to this device"
        footer={
          note ??
          (support === 'install'
            ? 'Add Rise to your Home Screen, then open it from there to turn this on.'
            : support === 'no'
              ? 'This browser can’t receive notifications.'
              : undefined)
        }
      >
        <GroupRow label="Notifications">
          <Toggle
            label="Notifications"
            on={on === true}
            disabled={support !== 'ok' || on === null || busy}
            onChange={(want) => void flip(want)}
          />
        </GroupRow>
        {on && (
          <div className="px-4 py-2">
            <Button variant="quiet" className="-ml-4" onClick={() => void test()}>
              Send a test
            </Button>
          </div>
        )}
      </Group>
      <Group title="Push me about">
        {PUSH_ROWS.map((r) => (
          <GroupRow key={r.key} label={r.label}>
            <Toggle
              label={r.label}
              on={push[r.key]}
              disabled={patch.isPending}
              onChange={(v) => patch.mutate({ ...push, [r.key]: v })}
            />
          </GroupRow>
        ))}
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
  const [renaming, setRenaming] = useState<CategoryGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [query, setQuery] = useState('');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('settings-action')), []);
  const q = query.trim().toLowerCase();
  // Transfers (account moves, card payments) is its own group, apart from expenses.
  const groupTab = (g: CategoryGroup): 'income' | 'expense' | 'transfer' =>
    g.kind === 'income' ? 'income' : isTransfersGroup(g.name) ? 'transfer' : 'expense';
  const matches = (c: Category, g: CategoryGroup) =>
    !q || g.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
  const shownGroups = groups.filter((g) => {
    if (groupTab(g) !== tab) return false;
    const all = categories.filter((c) => c.groupId === g.id);
    return all.length === 0 ? !q : all.some((c) => matches(c, g));
  });
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
  // Dragging reports the new order; every row whose place changed gets its position as its
  // sort order.
  const reorder = (
    kind: 'category-groups' | 'categories',
    current: { id: string; sortOrder: number }[],
    ids: string[],
  ) => {
    const byId = new Map(current.map((x) => [x.id, x]));
    void save(() =>
      Promise.all(
        ids.flatMap((id, i) =>
          byId.get(id)?.sortOrder === i ? [] : [api('PATCH', `/${kind}/${id}`, { sortOrder: i })],
        ),
      ),
    );
  };
  return (
    <>
      {slot &&
        createPortal(
          <Menu
            label="Category options"
            items={[
              { label: 'Add category', icon: 'plus', onSelect: () => setAdding(true) },
              {
                label: 'Add group',
                icon: 'plus',
                onSelect: () =>
                  setNewGroup({ name: '', kind: tab === 'income' ? 'income' : 'expense' }),
              },
            ]}
          />,
          slot,
        )}
      <label className="flex min-h-11 items-center gap-2 rounded-input bg-surface px-3 shadow-soft">
        <span className="text-ink-faint">
          <Icon name="search" size={18} />
        </span>
        <input
          aria-label="Search categories"
          className="min-w-0 flex-1 bg-transparent outline-none"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div role="tablist" className="mt-3 grid grid-cols-3 rounded-input bg-sage-100 p-1">
        {(['income', 'expense', 'transfer'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-9 rounded-[10px] font-medium ${
              tab === k ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted'
            }`}
          >
            {k === 'income' ? 'Income' : k === 'expense' ? 'Expenses' : 'Transfers'}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-clay">{error}</p>}
      <Sortable
        items={shownGroups}
        onReorder={(ids) =>
          reorder(
            'category-groups',
            groups,
            // Reordering a filtered tab keeps the other kind's groups where they were.
            [...ids, ...groups.filter((g) => !ids.includes(g.id)).map((g) => g.id)],
          )
        }
        className="list-none"
      >
        {(g, groupGrip) => {
          const inGroup = categories.filter((c) => c.groupId === g.id && matches(c, g));
          return (
            <section className="mt-5 overflow-hidden rounded-card bg-surface shadow-soft">
              <div className="flex items-center bg-sage-100/60">
                <span
                  {...(groupGrip as object)}
                  role="button"
                  aria-label={`Drag ${g.name} to reorder`}
                  className="flex size-11 shrink-0 items-center justify-center text-ink-faint"
                >
                  <Grip />
                </span>
                <h2 className="min-w-0 flex-1 truncate font-bold text-ink">{g.name}</h2>
                <IconButton
                  icon="pencil"
                  label={`Rename ${g.name}`}
                  onClick={() => setRenaming(g)}
                />
                {categories.filter((c) => c.groupId === g.id).length === 0 && (
                  <IconButton
                    icon="trash"
                    label={`Delete ${g.name}`}
                    onClick={() => void save(() => api('DELETE', `/category-groups/${g.id}`))}
                  />
                )}
              </div>
              <Sortable
                items={inGroup}
                onReorder={(ids) =>
                  reorder(
                    'categories',
                    categories.filter((c) => c.groupId === g.id),
                    ids,
                  )
                }
                className="divide-y divide-hairline"
              >
                {(c, grip) => (
                  <div className="flex items-center bg-surface">
                    <span
                      {...(grip as object)}
                      role="button"
                      aria-label={`Drag ${c.name} to reorder`}
                      className="flex size-11 shrink-0 items-center justify-center text-ink-faint"
                    >
                      <Grip />
                    </span>
                    <button
                      onClick={() => setEditing(c)}
                      className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-3 pr-4 text-left active:bg-sage-100"
                    >
                      {c.emoji && (
                        <span aria-hidden className="w-7 text-center text-xl leading-none">
                          {c.emoji}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{c.name}</span>
                        {/* Not rolling over is the norm, so only a category that does says so. */}
                        {(g.kind === 'expense' && c.budgeted && c.rolloverPolicy === 'roll') ||
                        (g.kind === 'expense' && c.budgeted && c.spendShape === 'fixed') ? (
                          <span className="block type-caption text-ink-faint">
                            {[
                              c.rolloverPolicy === 'roll' ? 'Rollover' : null,
                              c.spendShape === 'fixed' ? 'Like a bill' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                )}
              </Sortable>
              {g.kind === 'income' && (
                <div className="px-4 pb-3">
                  <IncomeCategoryAdd groupId={g.id} onSave={save} />
                </div>
              )}
            </section>
          );
        }}
      </Sortable>
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
      <Sheet open={renaming !== null} title="Rename group" onClose={() => setRenaming(null)}>
        {renaming && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save(() =>
                api('PATCH', `/category-groups/${renaming.id}`, { name: renaming.name.trim() }),
              ).then(() => setRenaming(null));
            }}
          >
            <input
              aria-label="Group name"
              className={input}
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              required
              data-sheet-focus
            />
            <Button type="submit" disabled={!renaming.name.trim()}>
              Save
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

/** Six dots: the handle to pick a row up by. */
function Grip() {
  return (
    <svg aria-hidden width="14" height="20" viewBox="0 0 14 20" className="fill-current">
      {[3, 10, 17].flatMap((y) =>
        [3, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />),
      )}
    </svg>
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

/** Rules are viewable, editable, deletable (T43). Editing replaces the rule. */
function RulesSection() {
  const rules = useRules();
  const categories = useCategories().data ?? [];
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = useGroups().data ?? [];
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Unknown';
  // Same split as the Categories tabs; a rule on an unknown category goes under Expenses.
  const ruleSection = (r: Rule): 'income' | 'expense' | 'transfer' => {
    const g = groups.find((g) => g.id === categories.find((c) => c.id === r.categoryId)?.groupId);
    return !g
      ? 'expense'
      : g.kind === 'income'
        ? 'income'
        : isTransfersGroup(g.name)
          ? 'transfer'
          : 'expense';
  };
  const SECTIONS = [
    { key: 'income', label: 'Income' },
    { key: 'expense', label: 'Expenses' },
    { key: 'transfer', label: 'Transfers' },
  ] as const;
  const refresh = () =>
    Promise.all(
      ['rules', 'review-queue', 'queue-count'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  const renderRule = (r: Rule) => (
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
      {SECTIONS.map(({ key, label }) => {
        const rows = (rules.data ?? []).filter((r) => ruleSection(r) === key);
        if (!rows.length) return null;
        return (
          <section key={key} className="mt-4">
            <h2 className="type-label text-ink-muted">{label}</h2>
            <ul className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
              {rows.map(renderRule)}
            </ul>
          </section>
        );
      })}
      <Button variant="quiet" className="-ml-4 mt-4" onClick={() => setEditing('new')}>
        Add a rule
      </Button>
      <Leaving>
        {editing && (
          <RuleSheet
            rule={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={refresh}
          />
        )}
      </Leaving>
    </>
  );
}

function SyncSection() {
  const status = useSyncStatus();
  const tz = useMe().data?.timezone;
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api<SyncRunResult>('POST', '/sync/run', {}),
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
      {run.isSuccess &&
        (() => {
          const o = syncOutcome(
            run.data,
            banksLastReported(
              (accounts.data ?? []).filter((a) => a.source === 'simplefin' && !a.archivedAt),
            ),
            tz,
          );
          return (
            <p
              role="status"
              className={`mt-2 ${o.tone === 'warn' ? 'text-clay' : 'text-ink-muted'}`}
            >
              {o.text}
            </p>
          );
        })()}
      <h2 className="mt-8 type-label text-ink-muted">Recent runs</h2>
      {status.data?.runs.length === 0 && <p className="mt-2 text-ink-muted">None yet.</p>}
      <ul className="mt-1 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
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

const LOCK_CHOICES: { id: AppLock; label: string; hint?: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'immediate', label: 'Immediately' },
  { id: '5m', label: 'After 5 minutes away' },
  { id: '1h', label: 'After 1 hour away' },
];

function SecuritySection() {
  const { registerPasskey, signOut, stepUp } = useAuth();
  const me = useMe().data;
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [pinSheet, setPinSheet] = useState(false);
  const [pinOn, setPinOn] = useState(hasPin);
  const [totpSheet, setTotpSheet] = useState(false);
  const [recoverySheet, setRecoverySheet] = useState(false);
  const lock = useMutation({
    mutationFn: (appLock: AppLock) => api('PATCH', '/me/settings', { appLock }),
    onMutate: (appLock) => {
      // Mirror it now, and count from this moment, so turning it on doesn't lock at once.
      lockStore.set(lockKeys.mode, appLock);
      lockStore.set(lockKeys.hiddenAt, null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const mode = lock.isPending ? (lock.variables ?? 'off') : (me?.settings.appLock ?? 'off');
  const devices = useDevices();
  const tz = me?.timezone;
  const seen = (iso: string) => shortDate(localToday(tz, new Date(iso)));
  const removePasskey = async (id: string, label: string | null) => {
    if (
      !window.confirm(`Remove the passkey on ${label ?? 'that device'}? It won't sign in anymore.`)
    )
      return;
    setMsg(null);
    try {
      await api('DELETE', `/devices/passkeys/${encodeURIComponent(id)}`, undefined, {
        stepUp: await stepUp(),
      });
      await qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (e) {
      setMsg(passkeyMessage(e, 'The passkey wasn’t removed.'));
    }
  };
  const signOutDevice = async (id: string) => {
    setMsg(null);
    try {
      await api('DELETE', `/devices/sessions/${id}`);
      await qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That device wasn’t signed out.');
    }
  };
  return (
    <>
      <Group title="App lock">
        {LOCK_CHOICES.map((c) => (
          <RadioRow
            key={c.id}
            name="app-lock"
            label={c.label}
            hint={c.hint}
            checked={mode === c.id}
            onSelect={() => lock.mutate(c.id)}
          />
        ))}
      </Group>
      {mode !== 'off' && (
        <Group title="Offline PIN">
          {pinOn ? (
            <>
              <button
                onClick={() => setPinSheet(true)}
                className="flex min-h-13 w-full items-center justify-between px-4 text-left active:bg-sage-100"
              >
                Change PIN
                <Chevron />
              </button>
              <button
                onClick={() => {
                  clearPin();
                  setPinOn(false);
                }}
                className="flex min-h-13 w-full items-center px-4 text-left text-clay active:bg-clay-100"
              >
                Turn off PIN
              </button>
            </>
          ) : (
            <button
              onClick={() => setPinSheet(true)}
              className="flex min-h-13 w-full items-center justify-between px-4 text-left active:bg-sage-100"
            >
              Set a PIN
              <Chevron />
            </button>
          )}
        </Group>
      )}
      <Group title="Passkeys">
        {devices.data?.passkeys.map((k) => (
          <GroupRow
            key={k.id}
            label={k.label ?? 'Passkey'}
            hint={`Added ${seen(k.createdAt)}${k.lastUsedAt ? ` · used ${seen(k.lastUsedAt)}` : ''}`}
          >
            {(devices.data?.passkeys.length ?? 0) > 1 && (
              <button
                className="min-h-11 shrink-0 font-semibold text-clay"
                onClick={() => void removePasskey(k.id, k.label)}
              >
                Remove
              </button>
            )}
          </GroupRow>
        ))}
        <button
          onClick={async () => {
            setMsg(null);
            try {
              await registerPasskey();
              setMsg('Passkey added.');
              await qc.invalidateQueries({ queryKey: ['devices'] });
            } catch (e) {
              setMsg(passkeyMessage(e, 'The passkey wasn’t added.'));
            }
          }}
          className="flex min-h-13 w-full items-center justify-between px-4 text-left active:bg-sage-100"
        >
          Add a passkey on this device
          <Chevron />
        </button>
      </Group>
      <Group title="Signed-in devices">
        {devices.data?.sessions.map((d) => (
          <GroupRow
            key={d.id}
            label={d.label ?? 'Unknown device'}
            hint={`Active ${seen(d.lastSeenAt ?? d.createdAt)}`}
          >
            {d.current ? (
              <span className="shrink-0 type-caption text-ink-muted">This device</span>
            ) : (
              <button
                className="min-h-11 shrink-0 font-semibold text-clay"
                onClick={() => void signOutDevice(d.id)}
              >
                Sign out
              </button>
            )}
          </GroupRow>
        ))}
        {!devices.data && <Skeleton className="m-4 h-5 w-40" />}
      </Group>
      {msg && <p className="mt-2 px-1 text-ink-muted">{msg}</p>}
      <Group title="Backup sign-in">
        <button
          onClick={() => setTotpSheet(true)}
          className="flex min-h-13 w-full items-center justify-between px-4 text-left active:bg-sage-100"
        >
          Set up an authenticator app
          <Chevron />
        </button>
        <button
          onClick={() => setRecoverySheet(true)}
          className="flex min-h-13 w-full items-center justify-between px-4 text-left active:bg-sage-100"
        >
          Generate recovery codes
          <Chevron />
        </button>
      </Group>
      <Leaving>{totpSheet && <TotpSetupSheet onClose={() => setTotpSheet(false)} />}</Leaving>
      <Leaving>
        {recoverySheet && <RecoveryCodesSheet onClose={() => setRecoverySheet(false)} />}
      </Leaving>
      <Button variant="quiet" className="-ml-4 mt-8" onClick={() => void signOut()}>
        Sign out
      </Button>
      <PinSheet
        open={pinSheet}
        onClose={() => setPinSheet(false)}
        onSaved={() => {
          setPinOn(true);
          setPinSheet(false);
        }}
      />
    </>
  );
}

function PinSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setFirst('');
    setSecond('');
    setError(null);
  };
  const save = async () => {
    if (!validPin(first)) return setError('Use 4 to 8 digits.');
    if (first !== second) return setError('Those don’t match.');
    await setPin(first);
    reset();
    onSaved();
  };
  const field =
    'min-h-12 w-full rounded-input border border-hairline bg-surface px-3 text-center text-xl tracking-[0.5em] money';
  return (
    <Sheet
      open={open}
      title="Offline PIN"
      onClose={() => {
        reset();
        onClose();
      }}
      action={{ label: 'Save', onClick: () => void save(), disabled: !first || !second }}
    >
      <form
        className="flex flex-col gap-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="type-label text-ink-muted">New PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className={field}
            value={first}
            onChange={(e) => setFirst(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="type-label text-ink-muted">Again</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className={field}
            value={second}
            onChange={(e) => setSecond(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        {error && <p className="text-clay">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/**
 * Authenticator app as a backup sign-in path — the way to get a brand-new phone or computer
 * into a signed-in session without a passkey already on it, so it can then register its own
 * passkey (Settings > Passkeys). One step-up covers both calls (5-minute token).
 */
function TotpSetupSheet({ onClose }: { onClose: () => void }) {
  const { stepUp } = useAuth();
  const [setup, setSetup] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const su = await stepUp();
      const r = await api<{ otpauthUri: string; secret: string }>(
        'POST',
        '/auth/totp/setup',
        {},
        { stepUp: su },
      );
      setSetup(r);
    } catch (e) {
      setError(passkeyMessage(e, 'Could not start setup.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const su = await stepUp();
      await api('POST', '/auth/totp/confirm', { code }, { stepUp: su });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Code not accepted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Authenticator app" onClose={onClose}>
      {done ? (
        <>
          <p className="text-ink-muted">
            Set up. On the new device, open Rise, choose “Use an authenticator code,” and enter your
            email and the current code — then add its own passkey from Settings.
          </p>
          <Button className="mt-4 w-full" onClick={onClose}>
            Done
          </Button>
        </>
      ) : !setup ? (
        <>
          <p className="text-ink-muted">
            Scan or enter this into an authenticator app (Google Authenticator, 1Password, Apple
            Passwords) on any device — including a phone that will use Rise on its own.
          </p>
          {error && <p className="mt-2 text-clay">{error}</p>}
          <Button className="mt-4 w-full" disabled={busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Start setup'}
          </Button>
        </>
      ) : (
        <>
          <p className="type-caption text-ink-muted">Secret key</p>
          <p className="mt-1 break-all rounded-input border border-hairline bg-canvas px-3 py-2 font-mono">
            {setup.secret}
          </p>
          <label className="mt-4 flex flex-col gap-1">
            <span className="type-caption text-ink-muted">Code from the app</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="min-h-11 rounded-input border border-hairline bg-canvas px-3 text-center tracking-widest"
            />
          </label>
          {error && <p className="mt-2 text-clay">{error}</p>}
          <Button
            className="mt-4 w-full"
            disabled={busy || code.length < 6}
            onClick={() => void confirm()}
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </Button>
        </>
      )}
    </Sheet>
  );
}

/** Ten single-use codes — shown once, stored hashed. Generating a fresh set retires any old ones. */
function RecoveryCodesSheet({ onClose }: { onClose: () => void }) {
  const { stepUp } = useAuth();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const su = await stepUp();
      const r = await api<{ codes: string[] }>(
        'POST',
        '/auth/recovery/generate',
        {},
        { stepUp: su },
      );
      setCodes(r.codes);
    } catch (e) {
      setError(passkeyMessage(e, 'Could not generate codes.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Recovery codes" onClose={onClose}>
      {!codes ? (
        <>
          <p className="text-ink-muted">
            Ten one-time codes to sign in without a passkey. Generating a new set retires any codes
            from before.
          </p>
          {error && <p className="mt-2 text-clay">{error}</p>}
          <Button className="mt-4 w-full" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Generating…' : 'Generate codes'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-ink-muted">Save these somewhere safe — shown once.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 rounded-card border border-hairline bg-canvas p-3 font-mono">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button className="mt-4 w-full" onClick={onClose}>
            Done
          </Button>
        </>
      )}
    </Sheet>
  );
}

const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)}k`
      : `${n}`;

/**
 * Cloudflare's free tier caps the database per UTC day (it resets at 7 pm Central). The Worker
 * counts what it uses, so this shows how close a day got, not just whether it failed.
 */
function UsageGroup() {
  const usage = useUsage().data;
  const today = usage?.days.find((d) => d.day === new Date().toISOString().slice(0, 10));
  const read = today?.rowsRead ?? 0;
  const written = today?.rowsWritten ?? 0;
  const pct = (n: number, cap: number) => Math.round((n / cap) * 100);
  const peak = (key: 'rowsRead' | 'rowsWritten') =>
    usage ? Math.max(0, ...usage.days.map((d) => d[key])) : 0;
  const line = (n: number, cap: number) => (
    <span className={`tabular-nums ${n / cap >= 0.8 ? 'text-clay' : 'text-ink-muted'}`}>
      {pct(n, cap)}% · {compact(n)} of {compact(cap)}
    </span>
  );
  return (
    <Group title="Database use (free daily limit)">
      {!usage ? (
        <GroupRow label="Today">
          <Skeleton className="h-5 w-24" />
        </GroupRow>
      ) : (
        <>
          <GroupRow label="Reads today">{line(read, usage.limits.rowsRead)}</GroupRow>
          <GroupRow label="Writes today">{line(written, usage.limits.rowsWritten)}</GroupRow>
          {usage.routes.map((r) => (
            <GroupRow key={r.route} label={r.route}>
              <span className="tabular-nums text-ink-muted">
                {compact(r.rowsRead)} reads · {r.requests}×
              </span>
            </GroupRow>
          ))}
          <GroupRow label="Busiest day, last 14">
            <span className="tabular-nums text-ink-muted">
              {pct(peak('rowsRead'), usage.limits.rowsRead)}% reads ·{' '}
              {pct(peak('rowsWritten'), usage.limits.rowsWritten)}% writes
            </span>
          </GroupRow>
        </>
      )}
    </Group>
  );
}

/** T46. The user can always walk away with their data (ARCHITECTURE §8). */
function DataSection() {
  const backups = useBackupStatus().data;
  const { stepUp } = useAuth();
  const [busy, setBusy] = useState<'json' | 'csv' | 'backup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The import panel's reads (batches, merges, feed overlaps) cost thousands of D1 rows on a
  // large history, so they load only when it's opened, not on every visit here.
  const [importOpen, setImportOpen] = useState(false);

  const download = async (format: 'json' | 'csv' | 'backup') => {
    setBusy(format);
    setError(null);
    try {
      // The backup file is the whole database, sign-in records included: confirm with a
      // passkey first, like adding a sign-in method.
      await downloadExport(format, format === 'backup' ? { stepUp: await stepUp() } : {});
    } catch {
      setError(
        format === 'backup'
          ? "That didn't go through. Confirm with your passkey to download the backup."
          : "That didn't go through. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const backupState = !backups
    ? undefined
    : backups.latest
      ? `Last night: ${shortDate(backups.latest.date)}`
      : 'None yet';

  return (
    <>
      <Group title="Export">
        <button
          onClick={() => void download('csv')}
          disabled={busy !== null}
          className="flex min-h-13 w-full items-center justify-between px-4 py-3 text-left active:bg-sage-100 disabled:opacity-60"
        >
          <span className="block">Transactions (CSV)</span>
          {busy === 'csv' ? (
            <span className="type-caption text-ink-muted">Preparing…</span>
          ) : (
            <Chevron />
          )}
        </button>
        <button
          onClick={() => void download('json')}
          disabled={busy !== null}
          className="flex min-h-13 w-full items-center justify-between px-4 py-3 text-left active:bg-sage-100 disabled:opacity-60"
        >
          <span className="block">Everything (JSON)</span>
          {busy === 'json' ? (
            <span className="type-caption text-ink-muted">Preparing…</span>
          ) : (
            <Chevron />
          )}
        </button>
      </Group>
      {error && <p className="mt-2 px-1 text-clay">{error}</p>}
      <Group title="Backups">
        <GroupRow label="Last backup">
          <span className="text-ink-muted">{backupState ?? <Skeleton className="h-5 w-24" />}</span>
        </GroupRow>
        {backups?.latest && (
          <button
            onClick={() => void download('backup')}
            disabled={busy !== null}
            className="flex min-h-13 w-full items-center justify-between px-4 py-3 text-left active:bg-sage-100 disabled:opacity-60"
          >
            <span className="block">Download latest backup</span>
            {busy === 'backup' ? (
              <span className="type-caption text-ink-muted">Preparing…</span>
            ) : (
              <Chevron />
            )}
          </button>
        )}
      </Group>
      <UsageGroup />
      <ClaudeGroup />
      {importOpen ? (
        <MonarchImport />
      ) : (
        <Group>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex min-h-13 w-full items-center justify-between px-4 py-3 text-left active:bg-sage-100"
          >
            <span className="block">Import from Monarch</span>
            <Chevron />
          </button>
        </Group>
      )}
    </>
  );
}

/** The optional, read-only Claude connector (SPEC §12.3). Off by default; Rise never needs it. */
function ClaudeGroup() {
  const qc = useQueryClient();
  const { stepUp } = useAuth();
  const state = useQuery({
    queryKey: ['connector'],
    queryFn: () => api<{ on: boolean; createdAt: string | null }>('GET', '/connector'),
  });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const flip = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const r = await api<{ url: string }>('POST', '/connector', undefined, {
          stepUp: await stepUp(),
        });
        setUrl(r.url);
      } else {
        await api('DELETE', '/connector');
        setUrl(null);
      }
      await qc.invalidateQueries({ queryKey: ['connector'] });
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group
      title="Claude"
      footer={
        url
          ? 'In Claude: Settings › Connectors › Add custom connector, and paste this link. It’s shown once.'
          : error
      }
    >
      <GroupRow label="Read-only connector">
        <Toggle
          label="Read-only connector"
          on={state.data?.on === true}
          disabled={!state.data || busy}
          onChange={(on) => void flip(on)}
        />
      </GroupRow>
      {url && (
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          className="flex min-h-13 w-full items-center justify-between gap-4 px-4 py-3 text-left active:bg-sage-100"
        >
          <span className="min-w-0 truncate text-ink-muted">{url}</span>
          <span className="shrink-0">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      )}
    </Group>
  );
}
