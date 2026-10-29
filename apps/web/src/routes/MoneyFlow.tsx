import type { MoneyFlowReport } from '@rise/shared/schemas';
import { sankey, sankeyLinkHorizontal, type SankeyNodeMinimal } from 'd3-sankey';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { series } from '../design/tokens';
import { formatCents } from '../lib/money';
import { useMoneyFlow } from '../lib/queries';

type FlowNode = MoneyFlowReport['nodes'][number];
type FlowLink = MoneyFlowReport['links'][number];
type Node = FlowNode & SankeyNodeMinimal<object, object>;

const WIDTH = 640;
const NODE_WIDTH = 14;
const INCOME_FILL = 'var(--color-sage-700)';
const LEFTOVER_FILL = 'var(--color-gold)';
/** Spending beyond income came from savings or credit: a debt-like flow, so clay, never red. */
const SHORTFALL_FILL = 'var(--color-clay)';

/** Distinct hues cycle per group and per category, so neighboring flows read apart —
 *  a single flat color per role (the old behavior) made every category node identical. */
const CATEGORY_FILL = [series[0], series[2], series[1], series[3]] as const;

function roleOf(id: string): 'income' | 'group' | 'category' | 'leftover' | 'shortfall' {
  if (id === 'income') return 'income';
  if (id === 'leftover') return 'leftover';
  if (id === 'shortfall') return 'shortfall';
  if (id.startsWith('group:')) return 'group';
  return 'category';
}

/** Assigns each node a color: fixed for income/leftover, cycling the palette for groups and
 *  categories separately (each an independent counter) so siblings differ. */
function buildPalette(nodes: readonly FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  let groupIdx = 0;
  let catIdx = 0;
  for (const n of nodes) {
    const role = roleOf(n.id);
    if (role === 'income') map.set(n.id, INCOME_FILL);
    else if (role === 'leftover') map.set(n.id, LEFTOVER_FILL);
    else if (role === 'shortfall') map.set(n.id, SHORTFALL_FILL);
    else if (role === 'group')
      map.set(n.id, CATEGORY_FILL[groupIdx++ % CATEGORY_FILL.length] as string);
    else map.set(n.id, CATEGORY_FILL[catIdx++ % CATEGORY_FILL.length] as string);
  }
  return map;
}

/** Money flow report (Reports tab): where a month's (or range's) income came from and went. */
export function MoneyFlowReportView({
  month,
  from = month,
  label,
}: {
  month: string;
  from?: string;
  /** "October" or "May – Oct 2026". */
  label: string;
}) {
  const flow = useMoneyFlow(month, from);
  const linkTo = (end: 'source' | 'target', id: string) =>
    flow.data?.links.find((l) => l[end] === id)?.valueCents ?? 0;
  // Negative when more went out than came in (the "From savings or credit" inflow).
  const leftoverCents = linkTo('target', 'leftover') - linkTo('source', 'shortfall');

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Left over, {label}</p>
      <p className="mt-1 type-display">
        {flow.data ? (
          <MoneyText cents={leftoverCents} tone={leftoverCents < 0 ? 'over' : 'ink'} />
        ) : (
          <Skeleton className="h-9 w-32" />
        )}
      </p>
      <div className="mt-4">
        {!flow.data ? (
          <Skeleton className="h-64 w-full" />
        ) : flow.data.links.length === 0 ? (
          <p className="py-6 text-ink-muted">
            Nothing to show yet — categorize some income and spending.
          </p>
        ) : (
          <Zoomable>
            <SankeyChart nodes={flow.data.nodes} links={flow.data.links} />
          </Zoomable>
        )}
      </div>
    </div>
  );
}

function SankeyChart({ nodes, links }: { nodes: readonly FlowNode[]; links: readonly FlowLink[] }) {
  const layout = useMemo(() => {
    const height = Math.max(180, nodes.length * 36);
    const graph = sankey<Node, { source: string; target: string; value: number }>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(16)
      .extent([
        [1, 1],
        [WIDTH - 1, height - 1],
      ])({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ source: l.source, target: l.target, value: l.valueCents })),
    });
    return { ...graph, height };
  }, [nodes, links]);
  const palette = useMemo(() => buildPalette(nodes), [nodes]);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${layout.height}`}
      width="100%"
      // A bare pixel `height` attribute doesn't scale with the percentage `width` — the box
      // ends up literally that many pixels tall while the content shrinks to fit the (much
      // narrower) actual width, leaving a band of empty space below it. `aspectRatio` keeps
      // the box's own proportions matched to the viewBox instead.
      style={{ aspectRatio: `${WIDTH} / ${layout.height}` }}
      role="img"
      aria-label="Money flow from income into expense categories this month"
    >
      <g>
        {layout.links.map((l, i) => {
          const source = l.source as Node;
          const target = l.target as Node;
          return (
            <path
              key={i}
              d={sankeyLinkHorizontal()(l) ?? undefined}
              fill="none"
              stroke={palette.get(target.id)}
              strokeOpacity={0.35}
              strokeWidth={Math.max(1, l.width ?? 0)}
            >
              <title>
                {source.name} → {target.name}: {formatCents(l.value ?? 0)}
              </title>
            </path>
          );
        })}
      </g>
      <g>
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))}
              fill={palette.get(n.id)}
              rx={2}
            >
              <title>
                {n.name}: {formatCents(n.value ?? 0)}
              </title>
            </rect>
            <text
              x={(n.x0 ?? 0) < WIDTH / 2 ? (n.x1 ?? 0) + 6 : (n.x0 ?? 0) - 6}
              y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
              dy="0.32em"
              textAnchor={(n.x0 ?? 0) < WIDTH / 2 ? 'start' : 'end'}
              className="type-caption fill-ink"
            >
              {n.name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

const MAX_ZOOM = 4;

/**
 * Pinch (or wheel) to zoom, drag to pan once zoomed, double-tap to reset. The one place in the
 * app where zoom is allowed, so it carries `data-zoomable` and does its own gesture handling.
 */
function Zoomable({ children }: { children: ReactNode }) {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const tap = useRef(0);

  const clamp = (k: number, x: number, y: number) => {
    const r = box.current?.getBoundingClientRect();
    const kk = Math.min(MAX_ZOOM, Math.max(1, k));
    if (!r || kk === 1) return { k: kk, x: 0, y: 0 };
    return {
      k: kk,
      x: Math.min(0, Math.max(r.width * (1 - kk), x)),
      y: Math.min(0, Math.max(r.height * (1 - kk), y)),
    };
  };
  // Zoom about a point in the box so it stays under the fingers.
  const zoomAt = (k: number, cx: number, cy: number) =>
    setView((v) => {
      const kk = Math.min(MAX_ZOOM, Math.max(1, k));
      const f = kk / v.k;
      return clamp(kk, cx - (cx - v.x) * f, cy - (cy - v.y) * f);
    });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const measure = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b
      ? { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      : null;
  };

  return (
    <div
      ref={box}
      data-zoomable
      className="relative touch-none overflow-hidden rounded-lg"
      onWheel={(e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        const p = local(e);
        zoomAt(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
      }}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, local(e));
        last.current = measure();
        const now = Date.now();
        if (pointers.current.size === 1 && now - tap.current < 300) setView({ k: 1, x: 0, y: 0 });
        tap.current = now;
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const cur = local(e);
        pointers.current.set(e.pointerId, cur);
        const m = measure();
        if (m && last.current) {
          const f = m.dist / last.current.dist;
          const prior = last.current;
          setView((v) => {
            const kk = Math.min(MAX_ZOOM, Math.max(1, v.k * f));
            const g = kk / v.k;
            return clamp(kk, m.cx - (prior.cx - v.x) * g, m.cy - (prior.cy - v.y) * g);
          });
          last.current = m;
        } else if (pointers.current.size === 1 && view.k > 1) {
          setView((v) => clamp(v.k, v.x + cur.x - prev.x, v.y + cur.y - prev.y));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        last.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        last.current = null;
      }}
    >
      <div
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      {view.k > 1 && (
        <button
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
          className="absolute top-2 right-2 min-h-9 rounded-full bg-surface px-3 type-caption shadow-soft"
        >
          Reset
        </button>
      )}
    </div>
  );
}
