/** Chart geometry (DESIGN-SYSTEM.md §7): pure, so the dashed-when-inferred rule is testable. */
export interface LinePoint {
  cents: number;
  inferred: boolean;
}

export interface Segment {
  dashed: boolean;
  points: [number, number][];
}

/**
 * Maps a series onto a width×height box and splits it into runs. A step between two points
 * is dashed if either end is inferred (interpolated or held) — inferred data is never drawn
 * as measured.
 */
export function lineSegments(
  points: readonly LinePoint[],
  width: number,
  height: number,
  pad = 4,
): Segment[] {
  if (points.length === 0) return [];
  const values = points.map((p) => p.cents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  // A flat series is steady, not zero: draw it through the middle, not along the floor.
  const y = (c: number) =>
    span === 0 ? height / 2 : pad + (1 - (c - lo) / span) * (height - 2 * pad);
  const out: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as LinePoint;
    const xy: [number, number] = [x(i), y(p.cents)];
    if (i === 0) {
      out.push({ dashed: p.inferred, points: [xy] });
      continue;
    }
    const dashed = p.inferred || (points[i - 1] as LinePoint).inferred;
    const cur = out.at(-1) as Segment;
    if (cur.dashed === dashed || cur.points.length === 1) {
      cur.dashed = dashed;
      cur.points.push(xy);
    } else {
      const prev = cur.points.at(-1) as [number, number];
      out.push({ dashed, points: [prev, xy] });
    }
  }
  return out;
}

export type Range = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';
export const RANGES: Range[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

/** Start date for a range ending today. ALL is capped at the API's 3-year window. */
export function rangeStart(range: Range, today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const back = (months: number) => {
    const idx = y * 12 + (m - 1) - months;
    const ny = Math.floor(idx / 12);
    const nm = (idx % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  switch (range) {
    case '1M':
      return back(1);
    case '3M':
      return back(3);
    case '6M':
      return back(6);
    case 'YTD':
      return `${y}-01-01`;
    case '1Y':
      return back(12);
    case 'ALL':
      return back(36);
  }
}

/** §7: never a percentage change over a window shorter than three months. */
export const allowsPercentChange = (range: Range) => range !== '1M';

/**
 * Several series on one shared scale (the Dashboard's month-against-month line). X is the
 * index across `slots` positions, so a series shorter than `slots` — a month in progress —
 * simply ends early instead of stretching. Y runs from 0 (or the lowest value, if a refund
 * takes a total below zero) to the highest value across every series.
 */
export function sharedScalePaths(
  series: readonly (readonly number[])[],
  slots: number,
  width: number,
  height: number,
  pad = 4,
): { points: [number, number][]; last: [number, number] | null }[] {
  const all = series.flat();
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const x = (i: number) => (slots <= 1 ? width / 2 : (i / (slots - 1)) * width);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - 2 * pad);
  return series.map((s) => {
    const points = s.map((v, i): [number, number] => [x(i), y(v)]);
    return { points, last: points.at(-1) ?? null };
  });
}
