import { Loading, PlanUnknown, useSettingsState } from '../components/Pending';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { RetirementPlan } from '@rise/shared/schemas';

type LifeEvent = RetirementPlan['lifeEvents'][number];
const clampClaim = (n: number) => Math.min(70, Math.max(62, n));
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { IconButton } from '../components/primitives/Icon';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
import { Toggle } from '../components/primitives/Toggle';
import { api } from '../lib/api';
import { formatCents } from '../lib/money';
import { useAccounts, useMe } from '../lib/queries';
import { AGE_MAX, AGE_MIN, DEFAULT_PLAN, retirementView, totalMonthly } from '../lib/retirement';

/** A whole-number or percent box that commits on blur, reverting what it can't read. */
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
  const shown = value / scale;
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || text.trim() === '') return setText(String(shown));
    const stored = Math.round(n * scale);
    if (stored !== value) onCommit(stored);
  };
  return (
    <span className="inline-flex min-h-11 items-center rounded-input border border-hairline bg-surface px-3 focus-within:border-sage-600">
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
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
  const contributionOf = (id: string) =>
    plan.contributions.find((c) => c.accountId === id)?.monthlyCents ?? 0;
  const setContribution = (id: string, monthlyCents: number) =>
    edit({
      contributions: [
        ...plan.contributions.filter((c) => c.accountId !== id),
        { accountId: id, monthlyCents },
      ],
    });

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
      <Sheet open={managing} title="Retirement settings" onClose={() => setManaging(false)}>
        <div className="overflow-hidden rounded-card bg-surface px-4">
          <EditRow
            label="Your age"
            field={
              <NumberField
                label="Your age"
                value={plan.currentAge}
                onCommit={(n) => edit({ currentAge: n })}
              />
            }
          />
          <EditRow
            label="Goal age"
            field={
              <NumberField
                label="Goal age"
                value={plan.goalAge}
                onCommit={(n) => edit({ goalAge: n })}
              />
            }
          />
          <EditRow
            label="Monthly spending goal"
            field={
              <MoneyField
                label="Monthly spending goal"
                cents={plan.spendTargetCents}
                onCommit={(c) => edit({ spendTargetCents: c })}
              />
            }
          />
          {retirementAccounts.map((a) => (
            <EditRow
              key={a.id}
              label={`${a.name} per month`}
              field={
                <MoneyField
                  label={`${a.name} monthly contribution`}
                  cents={contributionOf(a.id)}
                  onCommit={(c) => setContribution(a.id, c)}
                />
              }
            />
          ))}
          <EditRow
            label="Social Security at 67"
            field={
              <MoneyField
                label="Your Social Security at 67"
                cents={plan.ssBenefitCents}
                onCommit={(c) => edit({ ssBenefitCents: c })}
              />
            }
          />
          <EditRow
            label="You claim at"
            field={
              <NumberField
                label="Your claiming age"
                value={plan.ssClaimAge}
                onCommit={(n) => edit({ ssClaimAge: clampClaim(n) })}
              />
            }
          />
          <EditRow
            label="Spouse"
            field={
              <Toggle
                label="Plan for a spouse"
                on={plan.spouse !== null}
                onChange={(on) =>
                  edit({
                    spouse: on ? { age: plan.currentAge, ssBenefitCents: 0, ssClaimAge: 67 } : null,
                  })
                }
              />
            }
          />
          {plan.spouse && (
            <>
              <EditRow
                label="Spouse’s age"
                field={
                  <NumberField
                    label="Spouse’s age"
                    value={plan.spouse.age}
                    onCommit={(n) =>
                      plan.spouse &&
                      edit({ spouse: { ...plan.spouse, age: Math.min(100, Math.max(18, n)) } })
                    }
                  />
                }
              />
              <EditRow
                label="Spouse’s Social Security at 67"
                field={
                  <MoneyField
                    label="Spouse’s Social Security at 67"
                    cents={plan.spouse.ssBenefitCents}
                    onCommit={(c) =>
                      plan.spouse && edit({ spouse: { ...plan.spouse, ssBenefitCents: c } })
                    }
                  />
                }
              />
              <EditRow
                label="Spouse claims at"
                field={
                  <NumberField
                    label="Spouse’s claiming age"
                    value={plan.spouse.ssClaimAge}
                    onCommit={(n) =>
                      plan.spouse && edit({ spouse: { ...plan.spouse, ssClaimAge: clampClaim(n) } })
                    }
                  />
                }
              />
            </>
          )}
          <EditRow
            label="Count on Social Security"
            field={
              <NumberField
                label="Share of Social Security to count on"
                value={plan.ssHaircutPct}
                suffix="%"
                onCommit={(n) => edit({ ssHaircutPct: Math.min(100, n) })}
              />
            }
          />
          <EditRow
            label="Growth after inflation"
            field={
              <NumberField
                label="Growth after inflation"
                value={plan.realGrowthBps}
                scale={100}
                suffix="%"
                onCommit={(n) => edit({ realGrowthBps: n })}
              />
            }
          />
          <EditRow
            label="Withdrawal rate"
            field={
              <NumberField
                label="Withdrawal rate"
                value={plan.withdrawalBps}
                scale={100}
                suffix="%"
                onCommit={(n) => edit({ withdrawalBps: n })}
              />
            }
          />
          <EditRow
            label="Volatility"
            field={
              <NumberField
                label="Volatility"
                value={plan.volatilityBps}
                scale={100}
                suffix="%"
                onCommit={(n) => edit({ volatilityBps: n })}
              />
            }
          />
        </div>
      </Sheet>
    </>
  );
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
        onClick: () => onSave({ label: label.trim(), age, cents: moneyIn ? cents : -cents }),
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
          field={
            <NumberField
              label="Your age then"
              value={age}
              onCommit={(n) => setAge(Math.min(100, Math.max(18, n)))}
            />
          }
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
