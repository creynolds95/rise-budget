import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { dropIndex, edgeScroll, moveItem } from '../../lib/reorder';
import { scrollByY, scrollTop } from '../../lib/scroller';

/**
 * The part of the screen the list shows through: below the sticky title bar, above the tab
 * bar. Holding a row near either edge scrolls the page.
 */
function visibleBand(): { top: number; bottom: number } {
  let top = 0;
  for (const el of document.querySelectorAll<HTMLElement>('.banner')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top <= 1) top = Math.max(top, r.bottom);
  }
  let bottom = window.visualViewport?.height ?? window.innerHeight;
  const tabs = document.querySelector<HTMLElement>('nav[aria-label="Tabs"]');
  const r = tabs?.getBoundingClientRect();
  if (r && r.height > 0 && r.top < bottom) bottom = r.top;
  return { top, bottom };
}

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
 * order of ids. Touch-first: the grip opts out of scrolling, nothing else does. Holding a row
 * near the top or bottom of the screen scrolls the page under it.
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
  const start = useRef<{
    id: string;
    y: number;
    scroll: number;
    tops: number[];
    heights: number[];
  } | null>(null);
  const finger = useRef(0);
  const frame = useRef(0);
  const [drag, setDrag] = useState<{ id: string; dy: number; to: number } | null>(null);

  // Where the held row sits: the finger's travel plus however far the page has scrolled under it.
  const follow = () => {
    const s = start.current;
    if (!s) return;
    const from = items.findIndex((i) => i.id === s.id);
    const dy = finger.current - s.y + scrollTop() - s.scroll;
    setDrag({ id: s.id, dy, to: dropIndex(s.tops, s.heights, from, dy) });
  };
  const followRef = useRef(follow);
  followRef.current = follow;

  // While a row is held near the top or bottom edge, keep scrolling the page that way.
  const tick = () => {
    if (!start.current) return;
    const { top, bottom } = visibleBand();
    const step = edgeScroll(finger.current, top, bottom);
    if (step) {
      const before = scrollTop();
      scrollByY(step);
      if (scrollTop() !== before) followRef.current();
    }
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const grip = (id: string): GripProps => ({
    style: { touchAction: 'none', cursor: 'grab' },
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const els = items.map((i) => rows.current.get(i.id));
      start.current = {
        id,
        y: e.clientY,
        scroll: scrollTop(),
        tops: els.map((el) => el?.offsetTop ?? 0),
        heights: els.map((el) => el?.offsetHeight ?? 0),
      };
      finger.current = e.clientY;
      setDrag({ id, dy: 0, to: items.findIndex((i) => i.id === id) });
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
    },
    onPointerMove: (e) => {
      if (!start.current) return;
      finger.current = e.clientY;
      follow();
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
  });

  const finish = (commit: boolean) => {
    const s = start.current;
    start.current = null;
    cancelAnimationFrame(frame.current);
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
