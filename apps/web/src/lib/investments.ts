export type InvRange = '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y';
export const INV_RANGES: InvRange[] = ['1W', '1M', '3M', '6M', 'YTD', '1Y'];

export interface GrowthPoint {
  date: string;
  /** Percent change since the range began. */
  portfolio: number;
  sp500: number | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** First day of a range ending `today` (YYYY-MM-DD). */
export function invRangeStart(range: InvRange, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (range === 'YTD') return `${today.slice(0, 4)}-01-01`;
  if (range === '1W') d.setUTCDate(d.getUTCDate() - 7);
  else if (range === '1Y') d.setUTCFullYear(d.getUTCFullYear() - 1);
  else {
    // Clamped to the target month's last day: May 31 less 3 months is Feb 28, not Mar 3.
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (range === '1M' ? 1 : range === '3M' ? 3 : 6));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return iso(d);
}

/**
 * Both lines rebased to 0% at the first portfolio day on or after `start`. The index only
 * trades on weekdays, so each portfolio day reads the latest close on or before it.
 */
export function growthSeries(
  points: readonly { date: string; balanceCents: number }[],
  sp500: readonly { date: string; level: number }[] | null,
  start: string,
): GrowthPoint[] {
  const pts = points.filter((p) => p.date >= start);
  const first = pts[0];
  const base = first?.balanceCents;
  if (!first || !base) return [];
  const sp = [...(sp500 ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const at = (date: string) => {
    let hit: number | null = null;
    for (const s of sp) {
      if (s.date > date) break;
      hit = s.level;
    }
    return hit;
  };
  const sp0 = at(first.date) ?? sp.find((s) => s.date >= first.date)?.level ?? null;
  return pts.map((p) => {
    const level = at(p.date);
    return {
      date: p.date,
      portfolio: (p.balanceCents / base - 1) * 100,
      sp500: sp0 && level ? (level / sp0 - 1) * 100 : null,
    };
  });
}

export const signedPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
