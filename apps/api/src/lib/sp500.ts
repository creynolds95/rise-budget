/** S&P 500 daily closes for the Investments comparison. Index levels, not money. */
export interface IndexPoint {
  date: string;
  /** Close × 100, so the level stays an integer in transit. */
  level: number;
}

const toLevel = (n: number) => Math.round(n * 100);
const ymd = (d: string) => d.replaceAll('-', '');

export function parseYahoo(json: unknown): IndexPoint[] {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }
    | undefined;
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const out: IndexPoint[] = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (typeof c === 'number' && Number.isFinite(c))
      out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), level: toLevel(c) });
  });
  return out;
}

export function parseStooq(csv: string): IndexPoint[] {
  const out: IndexPoint[] = [];
  for (const line of csv.trim().split('\n').slice(1)) {
    const [date, , , , close] = line.trim().split(',');
    const c = Number(close);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(c))
      out.push({ date, level: toLevel(c) });
  }
  return out;
}

/** Yahoo first (no key), Stooq as the fallback; null when neither answers. */
export async function fetchSp500(
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
): Promise<IndexPoint[] | null> {
  try {
    const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const p2 = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86_400;
    const res = await fetcher(
      `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, cf: { cacheTtl: 3600, cacheEverything: true } },
    );
    if (res.ok) {
      const pts = parseYahoo(await res.json());
      if (pts.length > 0) return pts;
    }
  } catch {
    // fall through to the second source
  }
  try {
    const res = await fetcher(
      `https://stooq.com/q/d/l/?s=%5Espx&d1=${ymd(from)}&d2=${ymd(to)}&i=d`,
      { cf: { cacheTtl: 3600, cacheEverything: true } },
    );
    if (res.ok) {
      const pts = parseStooq(await res.text());
      if (pts.length > 0) return pts;
    }
  } catch {
    // no comparison line today
  }
  return null;
}
