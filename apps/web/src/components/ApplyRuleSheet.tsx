import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Button } from './primitives/Button';
import { Sheet } from './primitives/Sheet';

/** Waiting (not yet reviewed) transactions a just-saved rule would file. */
export async function waitingForRule(ruleId: string | undefined): Promise<string[]> {
  if (!ruleId) return [];
  try {
    return (await api<{ ids: string[] }>('GET', `/rules/${ruleId}/waiting`)).ids ?? [];
  } catch {
    // Optional extra: a failed lookup never blocks the rule itself.
    return [];
  }
}

/**
 * After a rule is saved: offer to file the transactions already waiting in the review queue.
 * Never silent (the owner's tap is the confirmation) and never touches reviewed history.
 */
export function ApplyRuleSheet({
  ids,
  categoryName,
  onClose,
}: {
  ids: string[];
  categoryName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = ids.length;
  return (
    <Sheet open title="File earlier ones too?" onClose={onClose}>
      <p>
        {n} earlier {n === 1 ? 'transaction' : 'transactions'} waiting for review match this rule.
        File {n === 1 ? 'it' : 'them'} as {categoryName}?
      </p>
      <p className="mt-1 type-caption text-ink-faint">
        Anything you've already reviewed stays as it is.
      </p>
      {error && <p className="mt-2 text-clay">{error}</p>}
      <div className="mt-6 flex flex-col gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api('POST', '/transactions/bulk-accept', { ids });
              await Promise.all(
                ['review-queue', 'queue-count', 'transactions', 'merchant'].map((k) =>
                  qc.invalidateQueries({ queryKey: [k] }),
                ),
              );
              onClose();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not file them.');
              setBusy(false);
            }
          }}
        >
          Yes, file {n === 1 ? 'it' : `all ${n}`}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Only new ones
        </Button>
      </div>
    </Sheet>
  );
}
