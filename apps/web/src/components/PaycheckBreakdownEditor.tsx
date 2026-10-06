import {
  DEDUCTION_KINDS,
  paycheckNet,
  paycheckNetAfter,
  type PaycheckBreakdown,
} from '@rise/shared/recurring';
import { shortDate } from '../lib/dates';
import { Button } from './primitives/Button';
import { MoneyField } from './primitives/MoneyField';
import { MoneyText } from './primitives/MoneyText';

const KIND_LABEL = {
  tax: 'Taxes',
  retirement: 'Retirement',
  health: 'Health',
  other: 'Other',
} as const;

/**
 * Gross pay down to the deposit, one editable line per deduction. Informational: the schedule's
 * amount is still what Surplus uses; "Use net" copies the figure over when the user wants it to.
 * With an amount change pending, each figure can also carry its value from that date.
 */
export function PaycheckBreakdownEditor({
  value,
  onChange,
  changeOn,
  amountCents,
  onUseNet,
}: {
  value: PaycheckBreakdown;
  onChange: (b: PaycheckBreakdown) => void;
  /** The pending amount change's date; shows the "from" column when set. */
  changeOn: string | null;
  amountCents: number;
  onUseNet: (netCents: number, netAfterCents: number | null) => void;
}) {
  const net = paycheckNet(value);
  const netAfter = changeOn ? paycheckNetAfter(value) : null;
  const setLine = (i: number, patch: Partial<PaycheckBreakdown['lines'][number]>) =>
    onChange({ ...value, lines: value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const cell = 'flex min-w-0 flex-1 flex-col gap-1';
  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex gap-3">
        <label className={cell}>
          <span className="type-caption text-ink-muted">Gross pay</span>
          <MoneyField
            label="Gross pay"
            cents={value.grossCents}
            draft
            onCommit={(c) => onChange({ ...value, grossCents: c })}
          />
        </label>
        {changeOn && (
          <label className={cell}>
            <span className="type-caption text-ink-muted">From {shortDate(changeOn)}</span>
            <MoneyField
              label="Gross pay after change"
              cents={value.nextGrossCents ?? value.grossCents}
              draft
              onCommit={(c) =>
                onChange({ ...value, nextGrossCents: c === value.grossCents ? undefined : c })
              }
            />
          </label>
        )}
      </div>
      {value.lines.map((l, i) => (
        <div key={i} className="flex flex-col gap-1 border-t border-hairline pt-3">
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Deduction name"
              value={l.label}
              onChange={(e) => setLine(i, { label: e.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-canvas px-2"
            />
            <select
              aria-label="Deduction type"
              value={l.kind}
              onChange={(e) => setLine(i, { kind: e.target.value as typeof l.kind })}
              className="min-h-11 rounded-input border border-hairline bg-canvas px-2"
            >
              {DEDUCTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <div className={cell}>
              <MoneyField
                label={`${l.label || 'Deduction'} amount`}
                cents={l.amountCents}
                draft
                onCommit={(c) => setLine(i, { amountCents: c })}
              />
            </div>
            {changeOn && (
              <div className={cell}>
                <MoneyField
                  label={`${l.label || 'Deduction'} amount after change`}
                  cents={l.nextAmountCents ?? l.amountCents}
                  draft
                  onCommit={(c) =>
                    setLine(i, { nextAmountCents: c === l.amountCents ? undefined : c })
                  }
                />
              </div>
            )}
            <Button
              variant="quiet"
              onClick={() => onChange({ ...value, lines: value.lines.filter((_, j) => j !== i) })}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="quiet"
        onClick={() =>
          onChange({
            ...value,
            lines: [...value.lines, { label: '', kind: 'tax', amountCents: 0 }],
          })
        }
      >
        Add deduction
      </Button>
      <div className="flex items-center justify-between border-t border-hairline pt-3">
        <span className="font-medium">Net deposit</span>
        <span className="flex items-center gap-3">
          <MoneyText cents={net} tone="in" />
          {netAfter != null && netAfter !== net && (
            <span className="type-caption text-ink-faint">
              <MoneyText cents={netAfter} /> from {shortDate(changeOn as string)}
            </span>
          )}
        </span>
      </div>
      {(net !== amountCents || (netAfter != null && netAfter !== net)) && (
        <Button variant="quiet" onClick={() => onUseNet(net, netAfter)}>
          Use net as the schedule amount
        </Button>
      )}
    </div>
  );
}
