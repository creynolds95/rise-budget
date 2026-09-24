import type { ReactNode } from 'react';

/**
 * An inset card of rows, for settings and edit sheets: label left, control right, hairlines
 * between. Rows inside are plain content; the card draws the dividers.
 */
export function Group({
  title,
  footer,
  children,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-2">
      {title && <h3 className="mb-2 px-1 type-label text-ink-muted">{title}</h3>}
      <div className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-soft">
        {children}
      </div>
      {footer && <p className="mt-2 px-1 type-caption text-ink-faint">{footer}</p>}
    </section>
  );
}

export function GroupRow({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex min-h-13 items-center justify-between gap-4 px-4 py-3">
      <Label {...(htmlFor ? { htmlFor } : {})} className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="mt-0.5 block type-caption text-ink-faint">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/** One choice of several, iOS-style: the whole row is the target, a check marks the pick. */
export function RadioRow({
  label,
  hint,
  checked,
  onSelect,
  name,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onSelect: () => void;
  name: string;
}) {
  return (
    <label className="flex min-h-13 cursor-pointer items-center justify-between gap-4 px-4 py-3 active:bg-sage-100">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="mt-0.5 block type-caption text-ink-faint">{hint}</span>}
      </span>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-sage-600 bg-sage-600' : 'border-hairline'
        }`}
      >
        {checked && <span className="size-2 rounded-full bg-surface" />}
      </span>
    </label>
  );
}
