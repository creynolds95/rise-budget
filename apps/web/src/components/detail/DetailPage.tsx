import type { ReactNode } from 'react';
import { BackLink } from '../BackLink';
import { PageBar } from '../../lib/pageBar';
import { useSwipeBack } from '../../lib/gestures';

/**
 * The five-zone detail template (DESIGN-SYSTEM.md §5). Zones are props, not children, so
 * the order is fixed by this component: they can be left out but never rearranged.
 */
export interface DetailPageProps {
  header: {
    /** Where back goes, and its name (the arrow's accessible label). */
    back: { label: string; to: string };
    title: string;
    /** The one primary action, or none. */
    action?: ReactNode;
  };
  /** The number this page is about. Left-aligned hero, never a chart. */
  identity?: { label: string; hero: ReactNode; context?: ReactNode } | undefined;
  shape?: ReactNode;
  facts?: ReactNode;
  /** A small header over the facts tile, when the page has more than one tile to tell apart. */
  factsTitle?: ReactNode;
  /** One card, or several side by side in the same zone (e.g. income and expenses split out). */
  related?:
    | { title: ReactNode; children: ReactNode }
    | { title: ReactNode; children: ReactNode }[]
    | undefined;
  manage?: ReactNode;
}

export const ZONES = ['header', 'identity', 'shape', 'facts', 'related', 'manage'] as const;

export function DetailPage(p: DetailPageProps) {
  if (!p.header.back.label.trim()) throw new Error('DetailPage: back control must name its origin');
  useSwipeBack(p.header.back.to);
  return (
    <article className="mx-auto max-w-2xl pb-24">
      <PageBar data-zone="header">
        <BackLink to={p.header.back.to} label={p.header.back.label} />
        <h1 className="truncate type-body font-semibold">{p.header.title}</h1>
        <div className="justify-self-end">{p.header.action}</div>
      </PageBar>
      {p.identity && (
        <section data-zone="identity" className="gutter pt-4 pb-6">
          <p className="type-label text-ink-muted">{p.identity.label}</p>
          <div className="mt-1 type-display">{p.identity.hero}</div>
          {p.identity.context && <p className="mt-1 text-ink-muted">{p.identity.context}</p>}
        </section>
      )}
      {p.shape && (
        // Without an identity zone above it, the shape needs its own room under the sticky
        // header, or the tallest bar meets the banner.
        <section data-zone="shape" className={`gutter pb-6 ${p.identity ? '' : 'pt-6'}`}>
          {p.shape}
        </section>
      )}
      {p.facts && (
        // Alone under the sticky header (no identity or shape above), it needs the same room.
        <section data-zone="facts" className={`gutter ${p.identity || p.shape ? '' : 'pt-4'}`}>
          {p.factsTitle && (
            <h2 className="mb-2 type-label font-semibold text-ink-muted">{p.factsTitle}</h2>
          )}
          <div className="overflow-hidden rounded-card bg-surface px-4 shadow-soft">{p.facts}</div>
        </section>
      )}
      {p.related &&
        (Array.isArray(p.related) ? p.related : [p.related]).map((r, i) => (
          <section key={i} data-zone="related" className="gutter pt-8">
            <h2 className="type-label font-semibold text-ink-muted">{r.title}</h2>
            <div className="mt-2 overflow-hidden rounded-card bg-surface px-4 shadow-soft">
              {r.children}
            </div>
          </section>
        ))}
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
