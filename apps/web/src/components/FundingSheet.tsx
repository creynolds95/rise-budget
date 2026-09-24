import type { Category } from '@rise/shared/schemas';
import { useEffect, useState } from 'react';
import { formatCents } from '../lib/money';
import { Button } from './primitives/Button';
import { MoneyField } from './primitives/MoneyField';
import { MoneyText } from './primitives/MoneyText';
import { Sheet } from './primitives/Sheet';

export interface FundingRequest {
  categoryId: string;
  plannedCents: number;
  shortfallCents: number;
  candidates: { categoryId: string; slackCents: number }[];
}

/** Greedy first draft: the most slack first, until the shortfall is covered. */
export function draftFunding(r: FundingRequest): Map<string, number> {
  const out = new Map<string, number>();
  let left = r.shortfallCents;
  for (const c of r.candidates) {
    if (left <= 0) break;
    const take = Math.min(c.slackCents, left);
    out.set(c.categoryId, take);
    left -= take;
  }
  return out;
}

/**
 * T38 / SPEC §2.6: raising a plan past the pool needs the money to come from somewhere.
 * Sources are ranked by slack and pre-filled; nothing moves until the user confirms.
 */
export function FundingSheet({
  request,
  categories,
  onConfirm,
  onClose,
}: {
  request: FundingRequest | null;
  categories: Category[];
  onConfirm: (funding: { fromCategoryId: string; amountCents: number }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [amounts, setAmounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (request) setAmounts(draftFunding(request));
  }, [request]);
  if (!request) return null;
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Category';
  const covered = [...amounts.values()].reduce((n, v) => n + v, 0);
  const short = request.shortfallCents - covered;
  const funding = [...amounts]
    .filter(([, v]) => v > 0)
    .map(([fromCategoryId, amountCents]) => ({ fromCategoryId, amountCents }));

  return (
    <Sheet open title={`Fund ${name(request.categoryId)}`} onClose={onClose}>
      <p className="text-ink-muted">
        Raising to {formatCents(request.plannedCents)} needs{' '}
        <MoneyText cents={request.shortfallCents} /> more than is unassigned. Take it from:
      </p>
      {request.candidates.length === 0 ? (
        <p className="mt-4 text-clay">
          No category has money to spare this month. Raise expected income instead.
        </p>
      ) : (
        <ul className="mt-4">
          {request.candidates.map((c) => (
            <li
              key={c.categoryId}
              className="flex min-h-14 items-center justify-between gap-4 border-b border-hairline py-2"
            >
              <span>
                {name(c.categoryId)}
                <span className="block type-caption text-ink-faint">
                  {formatCents(c.slackCents)} to spare
                </span>
              </span>
              <MoneyField
                label={`Take from ${name(c.categoryId)}`}
                cents={amounts.get(c.categoryId) ?? 0}
                onCommit={(v) =>
                  setAmounts(new Map(amounts).set(c.categoryId, Math.min(v, c.slackCents)))
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex items-center justify-between gap-4">
        <span className={short > 0 ? 'text-clay' : 'text-ink-muted'}>
          {short > 0 ? (
            <>
              Still <MoneyText cents={short} tone="over" /> short
            </>
          ) : (
            'Covered'
          )}
        </span>
        <Button
          disabled={short > 0 || busy || funding.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(funding);
            } finally {
              setBusy(false);
            }
          }}
        >
          Move {formatCents(covered)}
        </Button>
      </div>
    </Sheet>
  );
}
