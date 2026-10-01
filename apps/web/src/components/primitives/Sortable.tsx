import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { dropIndex, moveItem } from '../../lib/reorder';

/** What a row spreads on its grip: the only part of it that starts a drag. */
export interface GripProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  style: CSSProperties;
}

/**
 * A list whose rows can be picked up by their grip and dropped somewhere else. The row under
 * the finger follows it; the rows it passes slide out of the way; letting go reports the new
 * order of ids. Touch-first: the grip opts out of scrolling, nothing else does.
 */
export function Sortable<T extends { id: string }>({
  items,
  onReorder,
  children,
  className,
}: {
  items: readonly T[];
  onReorder: (ids: string[]) => void;
  children: (item: T, grip: GripProps, dragging: boolean) => ReactNode;
  className?: string;
}) {
  const rows = useRef(new Map<string, HTMLElement>());
  const start = useRef<{ id: string; y: number; tops: number[]; heights: number[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dy: number; to: number } | null>(null);

  const grip = (id: string): GripProps => ({
    style: { touchAction: 'none', cursor: 'grab' },
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const els = items.map((i) => rows.current.get(i.id));
      start.current = {
        id,
        y: e.clientY,
        tops: els.map((el) => el?.offsetTop ?? 0),
        heights: els.map((el) => el?.offsetHeight ?? 0),
      };
      setDrag({ id, dy: 0, to: items.findIndex((i) => i.id === id) });
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s) return;
      const from = items.findIndex((i) => i.id === s.id);
      const dy = e.clientY - s.y;
      setDrag({ id: s.id, dy, to: dropIndex(s.tops, s.heights, from, dy) });
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
  });

  const finish = (commit: boolean) => {
    const s = start.current;
    start.current = null;
    const d = drag;
    setDrag(null);
    if (!s || !d || !commit) return;
    const from = items.findIndex((i) => i.id === s.id);
    if (d.to !== from) onReorder(moveItem(items, from, d.to).map((i) => i.id));
  };

  const from = drag ? items.findIndex((i) => i.id === drag.id) : -1;
  const shift = (index: number): number => {
    if (!drag || from < 0 || !start.current) return 0;
    const { heights } = start.current;
    const h = heights[from] ?? 0;
    if (index === from) return drag.dy;
    if (from < drag.to && index > from && index <= drag.to) return -h;
    if (from > drag.to && index < from && index >= drag.to) return h;
    return 0;
  };

  return (
    <ul className={className}>
      {items.map((item, i) => (
        <li
          key={item.id}
          ref={(el) => {
            if (el) rows.current.set(item.id, el);
            else rows.current.delete(item.id);
          }}
          style={{
            transform: shift(i) ? `translateY(${shift(i)}px)` : undefined,
            transition: drag && drag.id !== item.id ? 'transform 150ms ease-out' : undefined,
            position: 'relative',
            zIndex: drag?.id === item.id ? 2 : undefined,
          }}
          className={drag?.id === item.id ? 'shadow-soft' : ''}
        >
          {children(item, grip(item.id), drag?.id === item.id)}
        </li>
      ))}
    </ul>
  );
}
