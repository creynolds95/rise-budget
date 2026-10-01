import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { isPushRoute, transitionClick } from '../../lib/transition';

/**
 * The three row types (§5.1), and only three. STATIC has no affordance, EDIT has the bordered
 * field, NAV has a chevron and always navigates. Tell them apart from across the room.
 */
const base = 'flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3';

export function StaticRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={base} data-row="static">
      <span className="min-w-0 text-ink-muted">{label}</span>
      <span className="shrink-0 text-right text-ink">{value}</span>
    </div>
  );
}

export function EditRow({ label, field }: { label: ReactNode; field: ReactNode }) {
  return (
    <div className={base} data-row="edit">
      <span className="text-ink-muted">{label}</span>
      {field}
    </div>
  );
}

export function NavRow({ label, value, to }: { label: ReactNode; value?: ReactNode; to: string }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      onClick={isPushRoute(to) ? transitionClick(navigate, to) : undefined}
      className={`${base} active:bg-sage-100`}
      data-row="nav"
    >
      <span className="min-w-0 text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-ink-muted">
        {value}
        <Chevron />
      </span>
    </Link>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden width="8" height="14" viewBox="0 0 8 14" className="shrink-0 stroke-ink-faint">
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A labeled field in a detail screen, Monarch-style: the label on the left, the value on the
 * right with no box around it. Tappable rows (`onClick`) show a chevron; the value is the
 * control, so there is no separate text field to find.
 */
export function ValueRow({
  label,
  children,
  onClick,
  muted = false,
}: {
  label: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  muted?: boolean;
}) {
  const inner = (
    <>
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span
        className={`flex min-w-0 items-center justify-end gap-2 text-right ${muted ? 'text-ink-faint' : 'text-ink'}`}
      >
        <span className="min-w-0 break-words">{children}</span>
        {onClick && <Chevron />}
      </span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${base} w-full text-left active:bg-sage-100`}
      data-row="edit"
    >
      {inner}
    </button>
  ) : (
    <div className={base} data-row="static">
      {inner}
    </div>
  );
}
