import type { ViewCategory } from '@rise/shared/budget';
import type { Category } from '@rise/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { get } from '../lib/api';
import { addMonths, monthName } from '../lib/dates';
import { pressKey, type Key } from '../lib/keypad';
import { centsToInput, formatCents, parseMoney } from '../lib/money';
import { planStats, upToDollar, type MonthSpend } from '../lib/plan';
import { useMe } from '../lib/queries';
import { MoneyText } from './primitives/MoneyText';
import { Leaving, Sheet, useLeaving } from './primitives/Sheet';
import { Toggle } from './primitives/Toggle';

export interface PlanEdit {
  category: Category;
  row: ViewCategory;
  month: string;
  poolCents: number;
}

/**
 * Tap a plan, change it (T37 follow-up). The number is the hero; recent spending sits under
 * it so the choice is informed, and one tap on a bar or a card fills it in.
 */
export function PlanEditorSheet({
  edit,
  onClose,
  onSave,
}: {
  edit: PlanEdit | null;
  onClose: () => void;
  onSave: (plannedCents: number, applyToFuture: boolean) => Promise<void>;
}) {
  return (
    <Leaving>
      {edit && (
        <Editor
          key={`${edit.month}:${edit.category.id}`}
          edit={edit}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Leaving>
  );
}

function Editor({
  edit,
  onClose,
  onSave,
}: {
  edit: PlanEdit;
  onClose: () => void;
  onSave: (plannedCents: number, applyToFuture: boolean) => Promise<void>;
}) {
  const { category, row, month } = edit;
  const me = useMe().data;
  const [text, setText] = useState(centsToInput(row.plannedCents).replace(/\.00$/, ''));
  // The amount opens selected, so the first key replaces it (as a selected field would).
  const [fresh, setFresh] = useState(true);
  // Add and Remove adjust the current plan by what you type; neither is the default.
  const [mode, setMode] = useState<'set' | 'add' | 'remove'>('set');
  const [hint, setHint] = useState(false);
  const [future, setFuture] = useState(me?.settings.planChangesApplyToFuture ?? false);
  const [busy, setBusy] = useState(false);

  const history = useQuery({
    queryKey: ['category-history', category.id, 13],
    queryFn: () => get<MonthSpend[]>(`/categories/${category.id}/history?months=13`),
  });
  const stats = planStats(history.data ?? [], month);
  const parsed = parseMoney(text);
  const delta = mode === 'set' ? 0 : (parsed ?? 0);
  const valid = parsed !== null && parsed >= 0 && (mode !== 'remove' || parsed <= row.plannedCents);
  const cents = !valid
    ? row.plannedCents
    : mode === 'set'
      ? parsed
      : mode === 'add'
        ? row.plannedCents + delta
        : row.plannedCents - delta;
  const set = (c: number) => {
    setText(centsToInput(c).replace(/\.00$/, ''));
    setFresh(true);
  };
  const pick = (m: 'add' | 'remove') => {
    if (mode === m) {
      setMode('set');
      set(row.plannedCents);
    } else {
      setMode(m);
      setText('');
      setFresh(false);
    }
  };
  const press = (k: Key) => {
    setText((t) => pressKey(t, k, fresh));
    setFresh(false);
  };
  const left = row.carriedInCents + cents - row.spentCents;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(cents, future);
    } finally {
      setBusy(false);
    }
  };
  // A hardware keyboard types into the amount too, until the sheet starts closing.
  const leaving = useLeaving();
  const keys = useRef({ press, save, leaving });
  keys.current = { press, save, leaving };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keys.current.leaving || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) keys.current.press(e.key as Key);
      else if (e.key === 'Backspace') keys.current.press('back');
      else if (e.key === 'Enter') void keys.current.save();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const monthShort = monthName(month, false);

  return (
    <Sheet
      open
      title={
        <>
          {category.emoji && <span className="mr-1.5">{category.emoji}</span>}
          {category.name}
        </>
      }
      onClose={onClose}
      fullScreen
      action={{
        label: busy ? 'Saving…' : 'Save',
        onClick: () => void save(),
        disabled: !valid || busy,
      }}
      dock={
        <>
          <div className="gutter border-t border-hairline bg-surface">
            <div className="flex min-h-14 items-center justify-between gap-4">
              <span className="min-w-0 text-[17px]">
                Apply {valid ? formatCents(cents, { whole: cents % 100 === 0 }) : ''} to all future
                months
                <button
                  type="button"
                  aria-label="What does this do?"
                  aria-expanded={hint}
                  onClick={() => setHint(!hint)}
                  className="ml-2 inline-flex size-5 translate-y-1 items-center justify-center rounded-full border border-ink-faint text-[11px] text-ink-faint"
                >
                  i
                </button>
              </span>
              <Toggle label="Apply to all future months" on={future} onChange={setFuture} />
            </div>
            {hint && (
              <p className="pb-3 type-caption text-ink-muted">
                {future
                  ? `${monthName(addMonths(month, 1), false)} onward plans this too. Months before stay as they are.`
                  : `Only ${monthShort} changes.`}
              </p>
            )}
          </div>
          <Keypad onPress={press} />
        </>
      }
    >
      <div className="grid grid-cols-2">
        {(['add', 'remove'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => pick(m)}
            aria-pressed={mode === m}
            className={`flex min-h-11 items-center justify-center gap-2 font-medium ${
              mode === m ? 'text-sage-700' : 'text-ink'
            }`}
          >
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              className="fill-none stroke-current"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d={m === 'add' ? 'M12 8v8M8 12h8' : 'M8 12h8'} />
            </svg>
            {m === 'add' ? 'Add' : 'Remove'}
          </button>
        ))}
      </div>
      <div className="flex justify-center pt-1">
        <output
          aria-label={`Planned for ${monthShort}`}
          aria-live="polite"
          aria-invalid={!valid}
          className={`flex items-baseline rounded-[10px] px-2 font-serif text-[40px] leading-[48px] tracking-tight money ${
            valid ? 'text-ink' : 'text-clay'
          } ${fresh ? 'bg-sage-100' : ''}`}
        >
          <span aria-hidden className="mr-0.5 text-ink-faint">
            {mode === 'add' ? '+$' : mode === 'remove' ? '−$' : '$'}
          </span>
          {text}
          {!fresh && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-9 w-0.5 translate-y-1 animate-caret bg-sage-700"
            />
          )}
        </output>
      </div>
      <p className="mt-1 text-center type-label tracking-widest text-ink-muted">
        Remaining:{' '}
        <MoneyText cents={left} tone={left < 0 ? 'over' : 'in'} className="font-semibold" />
      </p>
      {mode !== 'set' && (
        <p className="mt-1 text-center type-caption text-ink-muted">
          New plan for {monthShort}: <MoneyText cents={cents} tone="muted" />
        </p>
      )}
      {row.carriedInCents !== 0 && (
        <p className="mt-1 text-center type-caption text-ink-faint">
          Includes <MoneyText cents={row.carriedInCents} sign="always" tone="muted" /> carried from{' '}
          {monthName(addMonths(month, -1), false)}
        </p>
      )}

      {/* No history yet: nothing to compare against, so no block saying so (C16). */}
      {(history.isPending || stats.bars.some((b) => b.spentCents !== 0)) && (
        <>
          <SpendBars bars={stats.bars} planCents={cents} loading={history.isPending} onPick={set} />

          <div className="mt-3 grid grid-cols-2 gap-3">
            <QuickFill
              label="Spent last month"
              cents={stats.lastMonthCents}
              onPick={() => set(upToDollar(stats.lastMonthCents))}
            />
            <QuickFill
              label="Monthly average"
              cents={stats.averageCents}
              onPick={() => stats.averageCents !== null && set(upToDollar(stats.averageCents))}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}

const KEYS: (Key | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'back'];

/**
 * The app's own number pad. A native field can't open iOS's keypad without the
 * previous/next/done bar above it, and this one rises with the sheet instead of after it.
 */
function Keypad({ onPress }: { onPress: (k: Key) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 bg-hairline px-1.5 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
      {KEYS.map((k) =>
        k === null ? (
          <span key="blank" />
        ) : (
          <button
            key={k}
            type="button"
            onClick={() => onPress(k)}
            aria-label={k === 'back' ? 'Delete' : k}
            className={`flex h-12 items-center justify-center rounded-[8px] text-[25px] text-ink select-none ${
              k === 'back'
                ? 'active:bg-surface'
                : 'bg-surface shadow-[0_1px_0_rgba(0,0,0,0.18)] active:bg-hairline'
            }`}
          >
            {k === 'back' ? (
              <svg
                aria-hidden
                width="26"
                height="20"
                viewBox="0 0 26 20"
                className="fill-none stroke-current"
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                <path d="M8 2h15a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8l-6-8z" />
                <path d="M12 7l6 6M18 7l-6 6" />
              </svg>
            ) : (
              k
            )}
          </button>
        ),
      )}
    </div>
  );
}

function SpendBars({
  bars,
  planCents,
  loading,
  onPick,
}: {
  bars: MonthSpend[];
  planCents: number;
  loading: boolean;
  onPick: (cents: number) => void;
}) {
  const max = Math.max(1, planCents, ...bars.map((b) => b.spentCents));
  const H = 120;
  const line = Math.round((planCents / max) * H);
  return (
    <figure className="mt-5">
      <figcaption className="sr-only">Spent, last 6 months. Tap a month to use it.</figcaption>
      <div className="relative">
        <div className="flex items-end gap-2" style={{ height: H + 20 }}>
          {bars.map((b) => {
            const h = loading
              ? 8
              : Math.max(Math.round((b.spentCents / max) * H), b.spentCents > 0 ? 4 : 2);
            return (
              <button
                key={b.periodId}
                type="button"
                onClick={() => onPick(upToDollar(b.spentCents))}
                aria-label={`${monthName(b.periodId, false)}: ${formatCents(b.spentCents)}. Use this amount.`}
                className="group flex h-full flex-1 flex-col items-center justify-end"
              >
                <span className="relative z-10 mb-1 rounded bg-canvas px-1 type-caption font-medium text-ink-muted money">
                  {loading ? '' : formatCents(b.spentCents, { whole: true })}
                </span>
                <span
                  className={`w-full rounded-t-[6px] rounded-b-[2px] transition-[height] ${
                    loading ? 'animate-pulse bg-hairline' : 'bg-sage-300 group-active:bg-sage-600'
                  }`}
                  style={{ height: h }}
                />
              </button>
            );
          })}
        </div>
        {!loading && planCents > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-0 border-t-2 border-dashed border-sage-700"
            style={{ bottom: line }}
          />
        )}
      </div>
      <div aria-hidden className="mt-1 flex gap-2 type-caption text-ink-faint">
        {bars.map((b) => (
          <span key={b.periodId} className="flex-1 text-center">
            {monthName(b.periodId, false).slice(0, 3)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function QuickFill({
  label,
  cents,
  onPick,
}: {
  label: string;
  cents: number | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={cents === null}
      className="rounded-card bg-surface p-3 text-left shadow-soft active:bg-sage-100 disabled:opacity-50"
    >
      <span className="block text-[17px] font-semibold money">
        {cents === null ? '—' : formatCents(upToDollar(cents), { whole: true })}
      </span>
      <span className="type-caption text-ink-muted">{label}</span>
    </button>
  );
}
