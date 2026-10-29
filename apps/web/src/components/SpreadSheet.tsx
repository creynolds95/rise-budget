import { addPeriods, periodOf } from '@rise/shared/budget';
import type { Transaction } from '@rise/shared/schemas';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import { spreadMonths } from '../lib/spread';
import { Sheet } from './primitives/Sheet';

const CHOICES = [1, 2, 3, 4, 6, 12];

/**
 * Spread one charge evenly over months from its own (SPEC §3.6): a yearly bill draws on its
 * category a month at a time. Nothing saves until Save.
 */
export function SpreadSheet({
  t,
  onClose,
  onSaved,
}: {
  t: Transaction;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [months, setMonths] = useState(Math.max(spreadMonths(t), 1));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const start = periodOf(t.postedAt);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('POST', `/transactions/${t.id}/spread`, { months });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not spread this charge.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      title="Spread over months"
      onClose={onClose}
      action={{ label: saving ? 'Saving…' : 'Save', onClick: () => void save(), disabled: saving }}
    >
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Months">
        {CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={months === n}
            onClick={() => setMonths(n)}
            className={`min-h-12 rounded-input font-medium tabular-nums shadow-soft ${
              months === n ? 'bg-sage-600 text-surface' : 'bg-surface text-ink-muted'
            }`}
          >
            {n === 1 ? 'None' : `${n} months`}
          </button>
        ))}
      </div>
      <p className="mt-4 text-ink-muted tabular-nums">
        {months === 1
          ? `All ${formatCents(t.amountCents)} in ${monthName(start)}`
          : `${formatCents(Math.trunc(t.amountCents / months))} a month, ${monthName(start)} to ${monthName(addPeriods(start, months - 1))}`}
      </p>
      {error && <p className="mt-3 text-clay">{error}</p>}
    </Sheet>
  );
}
