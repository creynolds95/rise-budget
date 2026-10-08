import type { ReactNode } from 'react';
import { BackLink } from './BackLink';

/** The title block shared by Settings and Financial health: a back arrow when it has one, then the serif title. */
export function PageHeader({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="gutter pt-2">
      {back && (
        <div className="grid">
          <BackLink to={back.to} label={back.label} />
        </div>
      )}
      <h1 className={`type-title ${back ? '' : 'pt-2'}`}>{title}</h1>
      {subtitle && <p className="text-ink-muted">{subtitle}</p>}
    </header>
  );
}

/** A small uppercase heading over a group of rows. */
export function GroupHeading({ children }: { children: string }) {
  return <h2 className="type-label mt-6 mb-2 px-1 text-ink-muted">{children}</h2>;
}

/** The round sage badge that leads a row. */
export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sage-100 text-sage-700">
      {children}
    </span>
  );
}
