/** Pure helpers for drag-to-reorder lists. */

/** Move the item at `from` to position `to`, returning a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [picked] = next.splice(from, 1);
  if (picked === undefined) return next;
  next.splice(to, 0, picked);
  return next;
}

/**
 * Where a dragged row would land. `tops`/`heights` are each row's resting box; the dragged row
 * has moved `dy` pixels. It lands where its centre has crossed the centres of the rows it
 * passed, clamped to the ends.
 */
export function dropIndex(
  tops: readonly number[],
  heights: readonly number[],
  from: number,
  dy: number,
): number {
  const centre = (tops[from] ?? 0) + (heights[from] ?? 0) / 2 + dy;
  let to = from;
  for (let i = 0; i < tops.length; i++) {
    if (i === from) continue;
    const mid = (tops[i] ?? 0) + (heights[i] ?? 0) / 2;
    if (i < from && centre < mid) to = Math.min(to, i);
    if (i > from && centre > mid) to = Math.max(to, i);
  }
  return to;
}

/**
 * How far to scroll this frame while a row is held at `y`. Inside `zone` pixels of the visible
 * band's top or bottom edge the page scrolls toward that edge, faster the closer the finger
 * gets (up to `max` px a frame, past the edge included). Anywhere else, zero.
 */
export function edgeScroll(y: number, top: number, bottom: number, zone = 72, max = 16): number {
  const ramp = (depth: number) => Math.round(Math.min(1, depth / zone) ** 2 * max);
  if (y < top + zone) return -ramp(top + zone - y);
  if (y > bottom - zone) return ramp(y - (bottom - zone));
  return 0;
}
