import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The five-zone detail template (DESIGN-SYSTEM.md §5). Zones are props, not children, so
 * the order is fixed by this component: they can be left out but never rearranged.
 */
export interface DetailPageProps {
  header: {
    /** Where back goes, and its name: "‹ Budget", never a bare arrow. */
    back: { label: string; to: string };
    title: string;
    /** The one primary action, or none. */
    action?: ReactNode;
  };
  /** The number this page is about. Left-aligned hero, never a chart. */
  identity?: { label: string; hero: ReactNode; context?: ReactNode } | undefined;
  shape?: ReactNode;
  facts?: ReactNode;
  related?: { title: ReactNode; children: ReactNode } | undefined;
  manage?: ReactNode;
}

export const ZONES = ['header', 'identity', 'shape', 'facts', 'related', 'manage'] as const;

export function DetailPage(p: DetailPageProps) {
  if (!p.header.back.label.trim()) throw new Error('DetailPage: back control must name its origin');
  return (
    <article className="mx-auto max-w-2xl pb-24">
      <header
        data-zone="header"
        className="gutter sticky top-[var(--banner-h,0px)] z-10 grid min-h-14 grid-cols-[1fr_auto_1fr] items-center bg-canvas/95 backdrop-blur"
      >
        <Link
          to={p.header.back.to}
          className="flex min-h-11 items-center gap-1 justify-self-start text-sage-700"
        >
          <span aria-hidden>‹</span>
          {p.header.back.label}
        </Link>
        <h1 className="truncate type-body font-semibold">{p.header.title}</h1>
        <div className="justify-self-end">{p.header.action}</div>
      </header>
      {p.identity && (
        <section data-zone="identity" className="gutter pt-4 pb-6">
          <p className="type-label text-ink-muted">{p.identity.label}</p>
          <div className="mt-1 type-display">{p.identity.hero}</div>
          {p.identity.context && <p className="mt-1 text-ink-muted">{p.identity.context}</p>}
        </section>
      )}
      {p.shape && (
        <section data-zone="shape" className="gutter pb-6">
          {p.shape}
        </section>
      )}
      {p.facts && (
        <section data-zone="facts" className="gutter">
          <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">{p.facts}</div>
        </section>
      )}
      {p.related && (
        <section data-zone="related" className="gutter pt-8">
          <h2 className="type-label text-ink-muted">{p.related.title}</h2>
          <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {p.related.children}
          </div>
        </section>
      )}
      {p.manage && (
        <section data-zone="manage" className="gutter mt-12">
          <h2 className="type-label text-ink-muted">Manage</h2>
          <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
            {p.manage}
          </div>
        </section>
      )}
    </article>
  );
}
