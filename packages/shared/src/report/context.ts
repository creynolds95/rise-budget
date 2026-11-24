import { z } from 'zod';
import type { RawCategory, ReportCategory, ReportNarrative } from './index';

/**
 * Context the model may mention beyond the owner's own figures (SPEC §12.6): what counts as a
 * notable change, weather, gas prices, and the check that keeps the written parts to the facts
 * it was given. Pure: no I/O.
 */

/** Thresholds for "worth a mention": a change must clear BOTH the dollars and the percent. */
export const REPORT_CONFIG = {
  moverMinCents: 5_000,
  moverMinPctBp: 2_500,
  moverMax: 5,
  yoyMinCents: 7_500,
  yoyMinPctBp: 5_000,
  yoyMax: 4,
} as const;

// ── schemas ─────────────────────────────────────────────────────────────────

export const ReportYoy = z.object({
  name: z.string(),
  cents: z.int(),
  lastYearCents: z.int(),
  kind: z.enum(['new', 'gone', 'up', 'down']),
  /** Change against last year in basis points; null for new and gone. */
  pctBp: z.int().nullable(),
});
export type ReportYoy = z.infer<typeof ReportYoy>;

export const ReportTemps = z.object({
  avgHighF: z.int(),
  avgLowF: z.int(),
  maxF: z.int(),
  minF: z.int(),
  days: z.int(),
});
export type ReportTemps = z.infer<typeof ReportTemps>;

export const ReportWeather = z.object({
  month: ReportTemps,
  prev: ReportTemps.nullable(),
  lastYear: ReportTemps.nullable(),
});
export type ReportWeather = z.infer<typeof ReportWeather>;

/** Regular gasoline, whole cents per gallon, averaged over each month's weekly prices. */
export const ReportGas = z.object({
  region: z.string(),
  monthCents: z.int(),
  prevCents: z.int().nullable(),
  lastYearCents: z.int().nullable(),
});
export type ReportGas = z.infer<typeof ReportGas>;

/** What the owner told the report about their life, kept for later months. */
export const LifeNote = z.object({
  month: z.string(),
  text: z.string().max(160),
  status: z.enum(['kept', 'dismissed']),
});
export type LifeNote = z.infer<typeof LifeNote>;

// ── movers and year over year ───────────────────────────────────────────────

export type MoveKind = 'up' | 'down' | 'new' | 'gone';

/** The percent change in basis points; null when there was nothing to compare with. */
export function changeBp(nowCents: number, thenCents: number): number | null {
  return thenCents > 0 ? Math.round(((nowCents - thenCents) * 10_000) / thenCents) : null;
}

/** How a category moved, or null when it is not worth a mention (under the dollar or percent bar). */
export function moveKind(
  nowCents: number,
  thenCents: number,
  minCents: number,
  minPctBp: number,
): MoveKind | null {
  const delta = nowCents - thenCents;
  if (Math.abs(delta) < minCents) return null;
  if (thenCents <= 0) return nowCents > 0 ? 'new' : null;
  if (nowCents === 0) return 'gone';
  const bp = changeBp(nowCents, thenCents);
  if (bp === null || Math.abs(bp) < minPctBp) return null;
  return delta > 0 ? 'up' : 'down';
}

export function kindOf(r: ReportCategory): MoveKind | null {
  return moveKind(r.cents, r.prevCents, REPORT_CONFIG.moverMinCents, REPORT_CONFIG.moverMinPctBp);
}

/** Categories that moved against last year by enough dollars and percent, or appeared or vanished. */
export function yoyNotes(
  cur: readonly RawCategory[],
  lastYear: readonly RawCategory[] | null,
): ReportYoy[] {
  if (!lastYear || lastYear.length === 0) return [];
  const sum = (rows: readonly RawCategory[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.cents);
    return m;
  };
  const c = sum(cur);
  const y = sum(lastYear);
  const out: ReportYoy[] = [];
  for (const name of new Set([...c.keys(), ...y.keys()])) {
    const cents = c.get(name) ?? 0;
    const lastYearCents = y.get(name) ?? 0;
    const kind = moveKind(
      cents,
      lastYearCents,
      REPORT_CONFIG.yoyMinCents,
      REPORT_CONFIG.yoyMinPctBp,
    );
    if (kind) out.push({ name, cents, lastYearCents, kind, pctBp: changeBp(cents, lastYearCents) });
  }
  return out
    .sort((a, b) => Math.abs(b.cents - b.lastYearCents) - Math.abs(a.cents - a.lastYearCents))
    .slice(0, REPORT_CONFIG.yoyMax);
}

// ── weather and gas ─────────────────────────────────────────────────────────

export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  highF: number;
  lowF: number;
}

/** Monthly highs and lows from daily readings; null when the month has none. */
export function monthWeather(days: readonly WeatherDay[], month: string): ReportTemps | null {
  const d = days.filter((x) => x.date.startsWith(`${month}-`));
  if (d.length === 0) return null;
  const avg = (f: (x: WeatherDay) => number) =>
    Math.round(d.reduce((n, x) => n + f(x), 0) / d.length);
  return {
    avgHighF: avg((x) => x.highF),
    avgLowF: avg((x) => x.lowF),
    maxF: Math.round(Math.max(...d.map((x) => x.highF))),
    minF: Math.round(Math.min(...d.map((x) => x.lowF))),
    days: d.length,
  };
}

export interface GasPoint {
  /** YYYY-MM-DD, the week's date. */
  date: string;
  /** Price per gallon in cents. */
  cents: number;
}

/** Average weekly price in the month, whole cents; null with no weeks. */
export function monthGasCents(points: readonly GasPoint[], month: string): number | null {
  const p = points.filter((x) => x.date.startsWith(`${month}-`));
  return p.length === 0 ? null : Math.round(p.reduce((n, x) => n + x.cents, 0) / p.length);
}

/** "3.012" → 301. Decimal text to whole cents without floats; null when it isn't a price. */
export function priceToCents(s: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(3, '0');
  return Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
}

/** EIA's retail gasoline regions (PADD sub-regions), by state. */
export const GAS_REGIONS: Record<string, { code: string; label: string; states: string }> = {
  newEngland: { code: 'R1X', label: 'New England', states: 'CT ME MA NH RI VT' },
  centralAtlantic: { code: 'R1Y', label: 'Central Atlantic', states: 'DE DC MD NJ NY PA' },
  lowerAtlantic: { code: 'R1Z', label: 'Lower Atlantic', states: 'FL GA NC SC VA WV' },
  midwest: {
    code: 'R20',
    label: 'Midwest',
    states: 'IL IN IA KS KY MI MN MO NE ND OH OK SD TN WI',
  },
  gulfCoast: { code: 'R30', label: 'Gulf Coast', states: 'AL AR LA MS NM TX' },
  rockyMountain: { code: 'R40', label: 'Rocky Mountain', states: 'CO ID MT UT WY' },
  westCoast: { code: 'R50', label: 'West Coast', states: 'AK AZ CA HI NV OR WA' },
};

export function gasRegionOf(state: string): { code: string; label: string } | null {
  const s = state.trim().toUpperCase();
  for (const r of Object.values(GAS_REGIONS))
    if (r.states.split(' ').includes(s)) return { code: r.code, label: r.label };
  return null;
}

// ── formatting for the prompt ───────────────────────────────────────────────

/** Basis points as text: "25%", "1.8%". Integer math. */
export function formatPct(bp: number): string {
  const abs = Math.abs(bp);
  const tenths = Math.round(abs / 10);
  const whole = Math.floor(tenths / 10);
  const t = tenths % 10;
  return `${bp < 0 ? '-' : ''}${whole}${t === 0 ? '' : `.${t}`}%`;
}

// ── keeping the written parts to the facts ──────────────────────────────────

const NUM = /(\$?)(\d[\d,]*(?:\.\d+)?)(%|°)?/g;

interface Tok {
  kind: '$' | '%' | '°' | '';
  value: string;
}

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(NUM)) {
    const kind = m[1] ? '$' : ((m[3] ?? '') as '%' | '°' | '');
    out.push({ kind: kind as Tok['kind'], value: (m[2] as string).replace(/,/g, '') });
  }
  return out;
}

/** The numbers (with their unit) that the model was given. */
export function allowedNumbers(input: string): Set<string> {
  const s = new Set<string>();
  for (const t of tokens(input)) {
    s.add(`${t.kind}${t.value}`);
    if (t.kind === '$' && t.value.includes('.')) s.add(`$${Math.round(Number(t.value))}`);
  }
  return s;
}

/** Every number in `text` appears in the input, with the same unit (dates and years pass). */
export function isGrounded(text: string, allowed: ReadonlySet<string>): boolean {
  const any = new Set([...allowed].map((a) => a.replace(/^[$%°]/, '')));
  return tokens(text).every((t) => {
    if (allowed.has(`${t.kind}${t.value}`)) return true;
    if (t.kind !== '') return false;
    const n = Number(t.value);
    if (any.has(t.value)) return true;
    return Number.isInteger(n) && ((n >= 1 && n <= 31) || (n >= 1990 && n <= 2100));
  });
}

const sentences = (s: string): string[] => s.split(/(?<=[.!?])\s+(?=[A-Z"'])/).filter(Boolean);

/**
 * Drop every sentence, bullet or chip that states a number the model was not given. Returns the
 * cleaned narrative and how many pieces went, so the caller can ask again.
 */
export function groundNarrative(
  n: ReportNarrative,
  input: string,
): { narrative: ReportNarrative; dropped: number } {
  const allowed = allowedNumbers(input);
  let dropped = 0;
  const keep = (s: string) => {
    const ok = isGrounded(s, allowed);
    if (!ok) dropped++;
    return ok;
  };
  const text = (s: string) => sentences(s).filter(keep).join(' ');
  const narrative: ReportNarrative = {
    headlines: n.headlines.filter(keep),
    chips: n.chips.filter((c) => keep(c.text)),
    seasonal: text(n.seasonal),
    movers: text(n.movers),
    weather: text(n.weather),
    gas: text(n.gas),
    yoy: text(n.yoy),
    benchmarks: text(n.benchmarks),
    netWorth: text(n.netWorth),
    goals: text(n.goals),
    whatsNew: text(n.whatsNew),
    lifeNote: n.lifeNote && keep(n.lifeNote) ? n.lifeNote : '',
  };
  return { narrative, dropped };
}
