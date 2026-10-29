import type { Transaction } from '@rise/shared/schemas';

/** Small outlined letters after a merchant name: P for pending (gold), M for manually entered (sage), S for one category's part of a split (sage). */
export function TxnBadges({
  t,
  split = false,
}: {
  t: Pick<Transaction, 'isPending' | 'source'>;
  split?: boolean;
}) {
  return (
    <>
      {t.isPending && (
        <span
          className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
          title="Pending"
        >
          <span aria-hidden>P</span>
          <span className="sr-only">Pending</span>
        </span>
      )}
      {t.source === 'manual' && (
        <span
          className="ml-2 rounded-sm border border-sage-600 px-1 type-caption not-italic text-sage-700"
          title="Entered manually"
        >
          <span aria-hidden>M</span>
          <span className="sr-only">Entered manually</span>
        </span>
      )}
      {split && (
        <span
          className="ml-2 rounded-sm border border-sage-600 px-1 type-caption not-italic text-sage-700"
          title="Part of a split"
        >
          <span aria-hidden>S</span>
          <span className="sr-only">Part of a split</span>
        </span>
      )}
    </>
  );
}
