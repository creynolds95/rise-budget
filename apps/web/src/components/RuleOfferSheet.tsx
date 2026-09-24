import type { RuleOffer } from '@rise/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useCategories } from '../lib/queries';
import { Button } from './primitives/Button';
import { Sheet } from './primitives/Sheet';

/**
 * SPEC §4.6: a rule is permanent and overrides everything, so it is offered, never made.
 * Yes creates it; No suppresses offers for this merchant for good; Not now does nothing —
 * the server already reset the streak when it made the offer.
 */
export function RuleOfferSheet({
  offer,
  onClose,
}: {
  offer: RuleOffer | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const categories = useCategories().data ?? [];
  const [error, setError] = useState<string | null>(null);
  const name = categories.find((c) => c.id === offer?.categoryId)?.name ?? 'this category';
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all(
        ['rules', 'review-queue', 'queue-count'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };
  return (
    <Sheet open={offer !== null} title="Make it a rule?" onClose={onClose}>
      {offer && (
        <>
          <p>
            You've filed <strong className="font-semibold">{offer.merchant}</strong> as {name} 3
            times. Always do this?
          </p>
          <p className="mt-1 type-caption text-ink-faint">
            A rule files every future {offer.merchant} charge automatically. You can delete it in
            Settings.
          </p>
          {error && <p className="mt-2 text-clay">{error}</p>}
          <div className="mt-6 flex flex-col gap-2">
            <Button
              onClick={() =>
                act(() =>
                  api('POST', '/rules', {
                    matchField: 'merchant',
                    matchType: 'equals',
                    matchValue: offer.merchant,
                    categoryId: offer.categoryId,
                  }),
                )
              }
            >
              Yes, always
            </Button>
            <Button
              variant="quiet"
              onClick={() =>
                act(() =>
                  api('PATCH', `/merchants/${encodeURIComponent(offer.merchant)}`, {
                    suppressRuleOffer: true,
                  }),
                )
              }
            >
              No, don't ask again
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Not now
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
