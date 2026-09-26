import type { MoneyFlowReport } from '@rise/shared/schemas';
import { sankey, sankeyLinkHorizontal, type SankeyNodeMinimal } from 'd3-sankey';
import { useMemo } from 'react';
import { MoneyText } from '../components/primitives/MoneyText';
import { Skeleton } from '../components/primitives/Skeleton';
import { monthName } from '../lib/dates';
import { formatCents } from '../lib/money';
import { useMoneyFlow } from '../lib/queries';

type FlowNode = MoneyFlowReport['nodes'][number];
type FlowLink = MoneyFlowReport['links'][number];
type Node = FlowNode & SankeyNodeMinimal<object, object>;

const WIDTH = 640;
const NODE_WIDTH = 14;
const ROLE_FILL: Record<'income' | 'group' | 'category' | 'leftover', string> = {
  income: 'var(--color-sage-700)',
  group: 'var(--color-sage-600)',
  category: 'var(--color-sage-300)',
  leftover: 'var(--color-gold)',
};

function roleOf(id: string): keyof typeof ROLE_FILL {
  if (id === 'income') return 'income';
  if (id === 'leftover') return 'leftover';
  if (id.startsWith('group:')) return 'group';
  return 'category';
}

/** Money flow report (Reports tab): where a month's income came from and where it went. */
export function MoneyFlowReportView({ month }: { month: string }) {
  const flow = useMoneyFlow(month);
  const leftoverCents =
    flow.data?.links.find((l) => l.target === 'leftover')?.valueCents ?? (0 as const);

  return (
    <div className="overflow-hidden rounded-card bg-surface p-4 shadow-soft">
      <p className="type-label text-ink-muted">Left over in {monthName(month, false)}</p>
      <p className="mt-1 type-display">
        {flow.data ? <MoneyText cents={leftoverCents} /> : <Skeleton className="h-9 w-32" />}
      </p>
      <div className="mt-4">
        {!flow.data ? (
          <Skeleton className="h-64 w-full" />
        ) : flow.data.links.length === 0 ? (
          <p className="py-6 text-ink-muted">
            Nothing to show yet — categorize some income and spending this month.
          </p>
        ) : (
          <SankeyChart nodes={flow.data.nodes} links={flow.data.links} />
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

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${layout.height}`}
      width="100%"
      height={layout.height}
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
              stroke={ROLE_FILL[roleOf(target.id)]}
              strokeOpacity={0.3}
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
              fill={ROLE_FILL[roleOf(n.id)]}
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
