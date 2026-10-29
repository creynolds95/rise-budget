import type { Rule, RuleMatchField, RuleMatchType } from '@rise/shared/schemas';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useCategories } from '../lib/queries';
import { CategoryPicker } from './CategoryPicker';
import { Button } from './primitives/Button';
import { Sheet } from './primitives/Sheet';

export const RULE_FIELD: Record<RuleMatchField, string> = {
  merchant: 'Merchant',
  descriptor: 'Bank description',
};
export const RULE_TYPE: Record<RuleMatchType, string> = {
  equals: 'is',
  contains: 'contains',
  regex: 'matches pattern',
};

export function RuleSheet({
  rule,
  initial,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  /** Prefill for a new rule, e.g. from a transaction. */
  initial?: Pick<Rule, 'matchField' | 'matchType' | 'matchValue' | 'categoryId'>;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const categories = useCategories().data ?? [];
  const [field, setField] = useState<RuleMatchField>(
    rule?.matchField ?? initial?.matchField ?? 'merchant',
  );
  const [type, setType] = useState<RuleMatchType>(
    rule?.matchType ?? initial?.matchType ?? 'equals',
  );
  const [value, setValue] = useState(rule?.matchValue ?? initial?.matchValue ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? initial?.categoryId ?? '');
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
            {Object.entries(RULE_FIELD).map(([k, v]) => (
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
            {Object.entries(RULE_TYPE).map(([k, v]) => (
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
