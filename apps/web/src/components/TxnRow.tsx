import type { Transaction } from '@rise/shared/schemas';
import { Link } from 'react-router';
import { shortDate } from '../lib/dates';
import { TxnAmount } from './TxnAmount';
import { Chevron } from './primitives/Rows';

/** A transaction in a list: a NAV row. Pending shows italic with a P (SPEC §3.2). */
export function TxnRow({
  t,
  categoryName,
  from,
}: {
  t: Transaction;
  categoryName?: string | undefined;
  from?: string;
}) {
  return (
    <Link
      to={`/transactions/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`}
      className={`flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2 active:bg-sage-100 ${t.isPending ? 'italic' : ''}`}
    >
      <span className="min-w-0">
        <span className="block truncate">
          {t.merchantDisplay ?? t.merchantNormalized}
          {t.isPending && (
            <span
              className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
              title="Pending"
            >
              P
            </span>
          )}
        </span>
        <span className="block truncate type-caption text-ink-faint">
          {shortDate(t.postedAt)}
          {t.isTransfer
            ? ' · Transfer'
            : categoryName
              ? ` · ${categoryName}`
              : t.splits.length > 1
                ? ' · Split'
                : ''}
          {t.reviewState === 'needs_review' ? ' · To review' : ''}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <TxnAmount t={t} />
        <Chevron />
      </span>
    </Link>
  );
}
