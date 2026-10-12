import { Loading, PlanUnknown, useSettingsState } from '../components/Pending';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { monthlyIncomeFor } from '@rise/shared/retirement';
import type { RetirementPlan } from '@rise/shared/schemas';

type LifeEvent = RetirementPlan['lifeEvents'][number];
const clampClaim = (n: number) => Math.min(70, Math.max(62, n));
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { FanChart } from '../components/primitives/FanChart';
import { IconButton } from '../components/primitives/Icon';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow } from '../components/primitives/Rows';
import { Leaving, Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { api } from '../lib/api';
import { formatCents } from '../lib/money';
import { useAccounts, useMe } from '../lib/queries';
import {
  AGE_MAX,
  AGE_MIN,
  DEFAULT_PLAN,
  fanView,
  retirementView,
  totalMonthly,
} from '../lib/retirement';

/**
 * A whole-number or percent box. Every readable keystroke is reported, because the number pad
 * has no Return key and iOS doesn't blur a field when a button is tapped, so waiting for blur
 * lost the edit. Clamping belongs to whoever saves, not to the keystroke.
 */
function NumberField({
  value,
  label,
  onCommit,
  suffix,
  scale = 1,
}: {
  value: number;
  label: string;
  onCommit: (n: number) => void;
  suffix?: string;
  /** Stored value = shown value × scale (percent shown, basis points stored). */
  scale?: number;
}) {
  const [text, setText] = useState(String(value / scale));
  const read = (t: string) => {
    const n = Number(t);
    return t.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * scale);
  };
  // Follow outside changes, but never rewrite what's mid-typing ("3." reads as 3).
  useEffect(() => {
    setText((t) => (read(t) === value ? t : String(value / scale)));
  }, [value, scale]);
  return (
    <span className="inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600">
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const stored = read(e.target.value);
          if (stored !== null && stored !== value) onCommit(stored);
        }}
        onBlur={() => setText(String(value / scale))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="money w-14 bg-transparent text-right outline-none"
      />
      {suffix && <span className="ml-1 text-ink-muted">{suffix}</span>}
    </span>
  );
}

export function Retirement() {
  const me = useMe().data;
  const settings = useSettingsState();
  const accounts = useAccounts().data;
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (retirement: RetirementPlan) => api('PATCH', '/me/settings', { retirement }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const plan = me?.settings.retirement ?? null;
  const retirementAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.kind === 'investment' && !a.archivedAt),
    [accounts],
  );
  const ids = retirementAccounts.map((a) => a.id);
  const start = retirementAccounts.reduce((n, a) => n + a.balanceCents, 0);

  // The slider opens at the goal age every visit; moving it is a view, not a setting.
  const [age, setAge] = useState<number | null>(null);
  const shownAge = Math.min(AGE_MAX, Math.max(AGE_MIN, age ?? plan?.goalAge ?? 65));
  const [managing, setManaging] = useState(false);
  const [event, setEvent] = useState<{ index: number | null; e: LifeEvent } | null>(null);

  const header = {
    back: { label: 'Financial health', to: '/financial-health' },
    title: 'Retirement',
  };
  if (!me || !accounts) {
    return (
      <DetailPage
        header={header}
        shape={
          <Loading>
            <Skeleton className="h-64 w-full" />
          </Loading>
        }
      />
    );
  }
  if (!plan && settings !== 'current') {
    return <PlanUnknown header={header} label="Retirement" state={settings} />;
  }
  if (!plan) {
    return (
      <DetailPage
        header={header}
        identity={{
          label: 'Retirement',
          hero: <span className="text-ink-muted">Not set up</span>,
          context:
            retirementAccounts.length === 0
              ? 'Set an account’s kind to Investment and it counts here.'
              : undefined,
        }}
        manage={
          <div className="py-3">
            <Button onClick={() => save.mutate(DEFAULT_PLAN)} disabled={save.isPending}>
              Set up retirement plan
            </Button>
          </div>
        }
      />
    );
  }

  const edit = (patch: Partial<RetirementPlan>) => save.mutate({ ...plan, ...patch });
  const monthly = totalMonthly(plan, ids);
  const v = retirementView(plan, start, monthly, shownAge);
  const f = fanView(plan, start, monthly, shownAge);

  return (
    <>
      <DetailPage
        header={{
          ...header,
          action: (
            <IconButton icon="more" label="Retirement settings" onClick={() => setManaging(true)} />
          ),
        }}
        identity={{
          label: `Monthly spending at ${shownAge}`,
          hero: <MoneyText cents={v.incomeCents} whole />,
          context:
            v.pctOfGoal === null ? undefined : (
              <span className="money">
                {v.pctOfGoal}% of your {formatCents(plan.spendTargetCents, { whole: true })} goal
              </span>
            ),
        }}
        shape={
          <>
            <input
              type="range"
              aria-label="Retirement age"
              min={AGE_MIN}
              max={AGE_MAX}
              step={1}
              value={shownAge}
              onChange={(e) => setAge(Number(e.target.value))}
              className="w-full accent-sage-600"
            />
            <div className="flex justify-between type-caption text-ink-muted money">
              <span>{AGE_MIN}</span>
              <span>Age {shownAge}</span>
              <span>{AGE_MAX}</span>
            </div>
            {f.length > 1 && (
              <div className="mt-4">
                <FanChart
                  label="Range of projected balances"
                  fan={f}
                  withdrawalBps={plan.withdrawalBps}
                  income={(b) =>
                    monthlyIncomeFor(Math.max(0, b - v.setAsideCents), plan.withdrawalBps) +
                    v.ssMonthlyCents
                  }
                />
              </div>
            )}
          </>
        }
        facts={
          <>
            <StaticRow label="Today" value={<MoneyText cents={start} whole />} />
            <StaticRow
              label={`At ${shownAge}`}
              value={<MoneyText cents={v.balanceCents} whole />}
            />
            {v.ssMonthlyCents > 0 && (
              <StaticRow
                label="Social Security a month"
                value={<MoneyText cents={v.ssMonthlyCents} whole />}
              />
            )}
            {v.setAsideCents > 0 && (
              <StaticRow
                label="Set aside until checks start"
                value={<MoneyText cents={v.setAsideCents} whole />}
              />
            )}
            {v.lasts && (
              <StaticRow
                label={`Money lasts to ${plan.planToAge}`}
                value={
                  <span className="money">
                    {v.lasts.successPct}% of the time
                    {v.lasts.lastsToAge !== null &&
                      `, runs out at ${v.lasts.lastsToAge} if returns are steady`}
                  </span>
                }
              />
            )}
            {v.neededCents !== null && (
              <StaticRow
                label="Needed for goal"
                value={<MoneyText cents={v.neededCents} whole />}
              />
            )}
            {v.gapMonthlyCents !== null && (
              <StaticRow
                label={v.gapMonthlyCents === 0 ? 'Gap to goal' : 'Add per month to reach goal'}
                value={
                  v.gapMonthlyCents === 0 ? (
                    <span className="text-sage-700">On track</span>
                  ) : (
                    <MoneyText cents={v.gapMonthlyCents} whole />
                  )
                }
              />
            )}
          </>
        }
        related={{
          title: 'Life events',
          children: (
            <>
              {plan.lifeEvents.map((e, i) => (
                <button
                  key={`${e.label}-${i}`}
                  type="button"
                  onClick={() => setEvent({ index: i, e })}
                  className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-hairline py-3 text-left active:bg-sage-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{e.label}</span>
                    <span className="block type-caption text-ink-faint money">Age {e.age}</span>
                  </span>
                  {e.cents > 0 ? (
                    <span className="money text-sage-700">
                      +<MoneyText cents={e.cents} tone="in" whole />
                    </span>
                  ) : (
                    <MoneyText cents={-e.cents} whole />
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setEvent({
                    index: null,
                    e: { label: '', age: Math.max(plan.currentAge, 18) + 5, cents: 0 },
                  })
                }
                className="flex min-h-12 w-full items-center py-3 font-semibold text-sage-700"
              >
                Add a life event
              </button>
            </>
          ),
        }}
      />
      {event && (
        <LifeEventSheet
          initial={event.e}
          onClose={() => setEvent(null)}
          onSave={(e) => {
            const list = [...plan.lifeEvents];
            if (event.index === null) list.push(e);
            else list[event.index] = e;
            edit({ lifeEvents: list });
            setEvent(null);
          }}
          onDelete={
            event.index === null
              ? undefined
              : () => {
                  edit({ lifeEvents: plan.lifeEvents.filter((_, i) => i !== event.index) });
                  setEvent(null);
                }
          }
        />
      )}
      <Leaving>
        {managing && (
          <SettingsSheet
            plan={plan}
            accounts={retirementAccounts}
            onClose={() => setManaging(false)}
            onSave={(p) => {
              save.mutate(p);
              setManaging(false);
            }}
          />
        )}
      </Leaving>
    </>
  );
}

/** The plan's own numbers, edited as a draft and saved together. */
function SettingsSheet({
  plan,
  accounts,
  onClose,
  onSave,
}: {
  plan: RetirementPlan;
  accounts: { id: string; name: string }[];
  onClose: () => void;
  onSave: (plan: RetirementPlan) => void;
}) {
  const [draft, setDraft] = useState(plan);
  const set = (patch: Partial<RetirementPlan>) => setDraft((d) => ({ ...d, ...patch }));
  const contributionOf = (id: string) =>
    draft.contributions.find((c) => c.accountId === id)?.monthlyCents ?? 0;
  const setContribution = (id: string, monthlyCents: number) =>
    set({
      contributions: [
        ...draft.contributions.filter((c) => c.accountId !== id),
        { accountId: id, monthlyCents },
      ],
    });
  const sp = draft.spouse;
  const setSpouse = (patch: Partial<NonNullable<RetirementPlan['spouse']>>) =>
    sp && set({ spouse: { ...sp, ...patch } });
  return (
    <Sheet
      open
      title="Retirement settings"
      onClose={onClose}
      action={{ label: 'Save', onClick: () => onSave(finalize(draft)) }}
    >
      <h3 className="px-1 pb-1 type-caption text-ink-muted">You</h3>
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Your age"
          field={
            <NumberField
              label="Your age"
              value={draft.currentAge}
              onCommit={(n) => set({ currentAge: n })}
            />
          }
        />
        <EditRow
          label="Social Security at 67"
          field={
            <MoneyField
              label="Your Social Security at 67"
              cents={draft.ssBenefitCents}
              draft
              onCommit={(c) => set({ ssBenefitCents: c })}
            />
          }
        />
        <EditRow
          label="You claim at"
          field={
            <NumberField
              label="Your claiming age"
              value={draft.ssClaimAge}
              onCommit={(n) => set({ ssClaimAge: n })}
            />
          }
        />
      </div>
      <h3 className="mt-4 px-1 pb-1 type-caption text-ink-muted">Spouse</h3>
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Plan for a spouse"
          field={
            <Toggle
              label="Plan for a spouse"
              on={sp !== null}
              onChange={(on) =>
                set({
                  spouse: on ? { age: draft.currentAge, ssBenefitCents: 0, ssClaimAge: 67 } : null,
                })
              }
            />
          }
        />
        {sp && (
          <>
            <EditRow
              label="Spouse’s age"
              field={
                <NumberField
                  label="Spouse’s age"
                  value={sp.age}
                  onCommit={(n) => setSpouse({ age: n })}
                />
              }
            />
            <EditRow
              label="Spouse’s Social Security at 67"
              field={
                <MoneyField
                  label="Spouse’s Social Security at 67"
                  cents={sp.ssBenefitCents}
                  draft
                  onCommit={(c) => setSpouse({ ssBenefitCents: c })}
                />
              }
            />
            <EditRow
              label="Spouse claims at"
              field={
                <NumberField
                  label="Spouse’s claiming age"
                  value={sp.ssClaimAge}
                  onCommit={(n) => setSpouse({ ssClaimAge: n })}
                />
              }
            />
          </>
        )}
      </div>
      <h3 className="mt-4 px-1 pb-1 type-caption text-ink-muted">Plan, both of you</h3>
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="Goal age"
          field={
            <NumberField
              label="Goal age"
              value={draft.goalAge}
              onCommit={(n) => set({ goalAge: n })}
            />
          }
        />
        <EditRow
          label="Plan to age"
          field={
            <NumberField
              label="Plan to age"
              value={draft.planToAge}
              onCommit={(n) => set({ planToAge: n })}
            />
          }
        />
        <EditRow
          label="Monthly spending goal"
          field={
            <MoneyField
              label="Monthly spending goal"
              cents={draft.spendTargetCents}
              draft
              onCommit={(c) => set({ spendTargetCents: c })}
            />
          }
        />
        <EditRow
          label="Count on Social Security"
          field={
            <NumberField
              label="Share of Social Security to count on"
              value={draft.ssHaircutPct}
              suffix="%"
              onCommit={(n) => set({ ssHaircutPct: n })}
            />
          }
        />
        <EditRow
          label="Growth after inflation"
          field={
            <NumberField
              label="Growth after inflation"
              value={draft.realGrowthBps}
              scale={100}
              suffix="%"
              onCommit={(n) => set({ realGrowthBps: n })}
            />
          }
        />
        <EditRow
          label="Withdrawal rate"
          field={
            <NumberField
              label="Withdrawal rate"
              value={draft.withdrawalBps}
              scale={100}
              suffix="%"
              onCommit={(n) => set({ withdrawalBps: n })}
            />
          }
        />
        <EditRow
          label="Volatility"
          field={
            <NumberField
              label="Volatility"
              value={draft.volatilityBps}
              scale={100}
              suffix="%"
              onCommit={(n) => set({ volatilityBps: n })}
            />
          }
        />
      </div>
      <h3 className="mt-4 px-1 pb-1 type-caption text-ink-muted">Contributions by account</h3>
      <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        {accounts.map((a) => (
          <EditRow
            key={a.id}
            label={`${a.name} per month`}
            field={
              <MoneyField
                label={`${a.name} monthly contribution`}
                cents={contributionOf(a.id)}
                draft
                onCommit={(c) => setContribution(a.id, c)}
              />
            }
          />
        ))}
      </div>
    </Sheet>
  );
}

/** Bounds applied once, when the draft is saved, so typing "6" on the way to "67" isn't rewritten. */
function finalize(p: RetirementPlan): RetirementPlan {
  return {
    ...p,
    ssClaimAge: clampClaim(p.ssClaimAge),
    ssHaircutPct: Math.min(100, p.ssHaircutPct),
    spouse: p.spouse && {
      ...p.spouse,
      age: Math.min(100, Math.max(18, p.spouse.age)),
      ssClaimAge: clampClaim(p.spouse.ssClaimAge),
    },
  };
}

/** Add or change one life event: money in or out at an age, in today's dollars. */
function LifeEventSheet({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: LifeEvent;
  onClose: () => void;
  onSave: (e: LifeEvent) => void;
  onDelete: (() => void) | undefined;
}) {
  const [label, setLabel] = useState(initial.label);
  const [age, setAge] = useState(initial.age);
  const [cents, setCents] = useState(Math.abs(initial.cents));
  const [moneyIn, setMoneyIn] = useState(initial.cents > 0);
  const valid = label.trim().length > 0 && cents > 0;
  return (
    <Sheet
      open
      title={onDelete ? 'Life event' : 'New life event'}
      onClose={onClose}
      action={{
        label: 'Save',
        disabled: !valid,
        onClick: () =>
          onSave({
            label: label.trim(),
            age: Math.min(100, Math.max(18, age)),
            cents: moneyIn ? cents : -cents,
          }),
      }}
    >
      <div
        role="radiogroup"
        aria-label="Direction"
        className="flex gap-1 rounded-card bg-surface p-1"
      >
        {[
          { on: false, text: 'Money out' },
          { on: true, text: 'Money in' },
        ].map((o) => (
          <button
            key={o.text}
            type="button"
            role="radio"
            aria-checked={moneyIn === o.on}
            onClick={() => setMoneyIn(o.on)}
            className={`min-h-10 flex-1 rounded-input font-medium ${
              moneyIn === o.on ? 'bg-sage-600 text-surface' : 'text-ink-muted'
            }`}
          >
            {o.text}
          </button>
        ))}
      </div>
      <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
        <EditRow
          label="What"
          field={
            <input
              aria-label="What"
              value={label}
              maxLength={60}
              placeholder="College, a new roof…"
              onChange={(e) => setLabel(e.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-right outline-none"
            />
          }
        />
        <EditRow
          label="Your age"
          field={<NumberField label="Your age then" value={age} onCommit={setAge} />}
        />
        <EditRow
          label="Amount"
          field={<MoneyField label="Amount" cents={cents} draft onCommit={setCents} />}
        />
      </div>
      {onDelete && (
        <Button variant="danger" className="-ml-4 mt-6" onClick={onDelete}>
          Delete
        </Button>
      )}
    </Sheet>
  );
}
