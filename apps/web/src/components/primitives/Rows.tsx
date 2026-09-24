import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The three row types (§5.1), and only three. STATIC has no affordance, EDIT has the bordered
 * field, NAV has a chevron and always navigates. Tell them apart from across the room.
 */
const base = 'flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3';

export function StaticRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={base} data-row="static">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right text-ink">{value}</span>
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
  return (
    <Link to={to} className={`${base} active:bg-sage-100`} data-row="nav">
      <span className="text-ink">{label}</span>
      <span className="flex items-center gap-2 text-ink-muted">
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
