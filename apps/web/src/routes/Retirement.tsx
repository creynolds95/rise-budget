import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { RetirementPlan } from '@rise/shared/schemas';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { FanChart } from '../components/primitives/FanChart';
import { IconButton } from '../components/primitives/Icon';
import { MoneyField } from '../components/primitives/MoneyField';
import { MoneyText } from '../components/primitives/MoneyText';
import { EditRow, StaticRow } from '../components/primitives/Rows';
import { Sheet } from '../components/primitives/Sheet';
import { Skeleton } from '../components/primitives/Skeleton';
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

  const header = {
    back: { label: 'Financial health', to: '/financial-health' },
    title: 'Retirement',
  };
  if (!me || !accounts) {
    return <DetailPage header={header} shape={<Skeleton className="h-64 w-full" />} />;
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
            {f.fan.length > 1 && (
              <div className="mt-4">
                <FanChart label="Range of projected balances" fan={f.fan} />
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
            {f.successPct !== null && (
              <StaticRow
                label="Success rate"
                value={<span className="money">{f.successPct}%</span>}
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
      />
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
