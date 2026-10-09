/** Chart geometry (DESIGN-SYSTEM.md §7): pure, so the dashed-when-inferred rule is testable. */
export interface LinePoint {
  cents: number;
  inferred: boolean;
  /** What a touch on this point reads out, e.g. the date. */
  label?: string;
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
  // Anchored at 0 (like sharedScalePaths below), or an all-negative series plots identically
  // to an all-positive one — there's nothing on the chart to show it's underwater.
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo;
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  // Only a series flat at exactly $0 has no scale to speak of; draw that through the middle.
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

/** Every point's position in the same box `lineSegments` draws into. */
export function linePositions(
  points: readonly LinePoint[],
  width: number,
  height: number,
  pad = 4,
): [number, number][] {
  return lineSegments(points, width, height, pad).flatMap((s, i) =>
    // A segment after the first starts on the previous one's last point; count it once.
    i === 0 ? s.points : s.points.slice(1),
  );
}

/** Which of `count` evenly spaced points a touch at `fraction` (0–1) across the chart is on. */
export function nearestIndex(fraction: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
}

/** Where $0 falls on a `lineSegments` chart, so it can be drawn as a reference line. */
export function zeroY(points: readonly LinePoint[], height: number, pad = 4): number | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.cents);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo;
  if (span === 0) return null;
  return pad + (1 - (0 - lo) / span) * (height - 2 * pad);
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
export interface Slice {
  label: string;
  cents: number;
  color: string;
}

export interface PieArc {
  slice: Slice;
  path: string;
  percent: number;
}

/** Donut arcs for a set of slices, clockwise from 12 o'clock. Zero/negative slices are dropped. */
export function pieArcs(
  slices: readonly Slice[],
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
): PieArc[] {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.cents), 0);
  if (total <= 0) return [];
  const point = (r: number, a: number): [number, number] => [
    cx + r * Math.cos(a),
    cy + r * Math.sin(a),
  ];
  let angle = -Math.PI / 2;
  return slices
    .filter((s) => s.cents > 0)
    .map((s) => {
      const frac = s.cents / total;
      const start = angle;
      const end = frac >= 0.9999 ? start + Math.PI * 2 - 0.0001 : start + frac * Math.PI * 2;
      angle = start + frac * Math.PI * 2;
      const large = end - start > Math.PI ? 1 : 0;
      const [x0, y0] = point(outerR, start);
      const [x1, y1] = point(outerR, end);
      const [x2, y2] = point(innerR, end);
      const [x3, y3] = point(innerR, start);
      const path = `M ${x0} ${y0} A ${outerR} ${outerR} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${innerR} ${innerR} 0 ${large} 0 ${x3} ${y3} Z`;
      return { slice: s, path, percent: frac };
    });
}

export interface TreemapTile extends Slice {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Squarified treemap (Bruls/Huizing/van Wijk), a row at a time. Good enough for the handful
 * of categories a spending breakdown ever shows.
 */
export function squarifyTreemap(
  slices: readonly Slice[],
  width: number,
  height: number,
): TreemapTile[] {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.cents), 0);
  const items = slices.filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  if (total <= 0 || items.length === 0) return [];
  const area = (cents: number) => (cents / total) * width * height;

  const tiles: TreemapTile[] = [];
  let x = 0;
  let y = 0;
  let remainingW = width;
  let remainingH = height;
  let i = 0;
  while (i < items.length) {
    const horizontal = remainingW >= remainingH;
    const rowLength = horizontal ? remainingH : remainingW;
    let rowArea = 0;
    let row: Slice[] = [];
    let bestWorst = Infinity;
    let j = i;
    while (j < items.length) {
      const item = items[j] as Slice;
      const candidateArea = rowArea + area(item.cents);
      const candidateRow = [...row, item];
      const thickness = candidateArea / rowLength;
      const worst = Math.max(
        ...candidateRow.map((it) => {
          const side = area(it.cents) / thickness;
          return Math.max(side / thickness, thickness / side);
        }),
      );
      if (worst > bestWorst && row.length > 0) break;
      bestWorst = worst;
      row = candidateRow;
      rowArea = candidateArea;
      j++;
    }
    const rowThickness = rowArea / rowLength;
    let offset = 0;
    for (const it of row) {
      const len = area(it.cents) / rowThickness;
      if (horizontal) {
        tiles.push({ ...it, x, y: y + offset, width: rowThickness, height: len });
      } else {
        tiles.push({ ...it, x: x + offset, y, width: len, height: rowThickness });
      }
      offset += len;
    }
    if (horizontal) {
      x += rowThickness;
      remainingW -= rowThickness;
    } else {
      y += rowThickness;
      remainingH -= rowThickness;
    }
    i = j;
  }
  return tiles;
}

export function sharedScalePaths(
  series: readonly (readonly number[])[],
  slots: number,
  width: number,
  height: number,
  pad = 4,
  /** Force the top of the scale, e.g. to a gridline from `niceTicks`. */
  top?: number,
): { points: [number, number][]; last: [number, number] | null }[] {
  const all = series.flat();
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, top ?? 0, ...all);
  const span = hi - lo || 1;
  const x = (i: number) => (slots <= 1 ? width / 2 : (i / (slots - 1)) * width);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - 2 * pad);
  return series.map((s) => {
    const points = s.map((v, i): [number, number] => [x(i), y(v)]);
    return { points, last: points.at(-1) ?? null };
  });
}

/**
 * Round gridline values from $0 up past `maxCents`: a 1/2/5 step, three or four lines.
 * The last tick is the top of the scale, so the data never touches the ceiling.
 */
export function niceTicks(maxCents: number): number[] {
  const max = Math.max(maxCents, 100) / 100;
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) as number) * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 100));
  return ticks;
}

/** "$2K", "$12K", "$1.5M": axis labels, whole dollars below a thousand. */
export function axisLabel(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${+(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${+(d / 1_000).toFixed(1)}K`;
  return `$${Math.round(d)}`;
}
