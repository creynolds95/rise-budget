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
  hideDate = false,
  onRecategorize,
}: {
  t: Transaction;
  categoryName?: string | undefined;
  from?: string;
  /** Under a date header the date would only repeat it. */
  hideDate?: boolean;
  /** Batch review: a tap on the category opens a picker here instead of navigating away. */
  onRecategorize?: (() => void) | undefined;
}) {
  return (
    <div
      className={`flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2 ${t.isPending ? 'italic' : ''}`}
    >
      <Link
        to={`/transactions/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`}
        className="min-w-0 flex-1 active:opacity-70"
      >
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
          {[
            hideDate ? null : shortDate(t.postedAt),
            t.isTransfer ? 'Transfer' : (categoryName ?? (t.splits.length > 1 ? 'Split' : null)),
            t.reviewState === 'needs_review' ? 'To review' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Uncategorized'}
        </span>
      </Link>
      <span className="flex items-center gap-2">
        <TxnAmount t={t} />
        {onRecategorize ? (
          <button
            type="button"
            aria-label={`Change category for ${t.merchantDisplay ?? t.merchantNormalized}`}
            onClick={onRecategorize}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-700"
          >
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 24 24"
              className="fill-none stroke-current"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.6 12.6 12.6 4.6a2 2 0 0 0-1.4-.6H5a2 2 0 0 0-2 2v6.2a2 2 0 0 0 .6 1.4l8 8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8Z" />
              <circle cx="7.5" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
            </svg>
          </button>
        ) : (
          <Link to={`/transactions/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`}>
            <Chevron />
          </Link>
        )}
      </span>
    </div>
  );
}
