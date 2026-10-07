import type { Transaction } from '@rise/shared/schemas';
import { merchantName } from '../lib/merchant';
import { Link, useNavigate } from 'react-router';
import { shortDate } from '../lib/dates';
import { transitionClick } from '../lib/transition';
import { TxnAmount } from './TxnAmount';
import { Chevron } from './primitives/Rows';

/** A transaction in a list: a NAV row. Pending shows italic with a P (SPEC §3.2). */
export function TxnRow({
  t,
  categoryEmoji,
  from,
  hideDate = false,
  onRecategorize,
}: {
  t: Transaction;
  /** Shown before the merchant name; the category's name isn't repeated on the row. */
  categoryEmoji?: string | null | undefined;
  from?: string;
  /** Under a date header the date would only repeat it. */
  hideDate?: boolean;
  /** Batch review: a tap on the category opens a picker here instead of navigating away. */
  onRecategorize?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const caption = [
    hideDate ? null : shortDate(t.postedAt),
    t.isTransfer ? 'Transfer' : t.splits.length > 1 ? 'Split' : null,
    t.reviewState === 'needs_review' ? 'To review' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const to = `/transactions/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  return (
    <div
      className={`flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2 ${t.isPending ? 'italic' : ''}`}
    >
      <Link
        to={to}
        onClick={transitionClick(navigate, to)}
        className="min-w-0 flex-1 active:opacity-70"
      >
        <span className="block truncate">
          {categoryEmoji && (
            <span aria-hidden className="mr-2 not-italic">
              {categoryEmoji}
            </span>
          )}
          {merchantName(t)}
          {t.isPending && (
            <span
              className="ml-2 rounded-sm border border-gold px-1 type-caption not-italic text-gold-text"
              title="Pending"
            >
              <span aria-hidden>P</span>
              <span className="sr-only">Pending</span>
            </span>
          )}
        </span>
        {caption && <span className="block truncate type-caption text-ink-faint">{caption}</span>}
      </Link>
      <span className="flex items-center gap-2">
        <TxnAmount t={t} />
        {onRecategorize ? (
          <button
            type="button"
            aria-label={`Change category for ${merchantName(t)}`}
            onClick={onRecategorize}
            className="hit-44 flex size-9 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-700"
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
          // The row's own link already goes here; this is the same target, out of the tab order.
          <Link to={to} onClick={transitionClick(navigate, to)} tabIndex={-1} aria-hidden>
            <Chevron />
          </Link>
        )}
      </span>
    </div>
  );
}
