import {
  gasRegionOf,
  monthGasCents,
  monthWeather,
  priceToCents,
  type GasPoint,
  type ReportGas,
  type ReportWeather,
  type WeatherDay,
} from '@rise/shared/report';
import { addPeriods, periodEnd, periodStart } from '@rise/shared/budget';

/**
 * Outside context for the monthly report (SPEC §12.6): weather for the owner's ZIP and the
 * regional gas price. Both are optional and best-effort: any failure returns null and the
 * report simply has no such section. The ZIP goes to zippopotam.us and its coordinates to
 * Open-Meteo; no budget data goes anywhere.
 */

interface Place {
  lat: string;
  lon: string;
  state: string;
}

export async function lookupZip(zip: string, fetcher: typeof fetch): Promise<Place | null> {
  try {
    const res = await fetcher(`https://api.zippopotam.us/us/${zip}`, {
      cf: { cacheTtl: 86_400 * 30, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      places?: { latitude?: string; longitude?: string; 'state abbreviation'?: string }[];
    };
    const p = body.places?.[0];
    if (!p?.latitude || !p.longitude || !p['state abbreviation']) return null;
    return { lat: p.latitude, lon: p.longitude, state: p['state abbreviation'] };
  } catch {
    return null;
  }
}

/** Open-Meteo's archive answer as daily readings; rows with a missing value are skipped. */
export function parseOpenMeteo(json: unknown): WeatherDay[] {
  const d = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const time = d?.['time'];
  const hi = d?.['temperature_2m_max'];
  const lo = d?.['temperature_2m_min'];
  if (!Array.isArray(time) || !Array.isArray(hi) || !Array.isArray(lo)) return [];
  const out: WeatherDay[] = [];
  time.forEach((date: unknown, i: number) => {
    const h: unknown = hi[i];
    const l: unknown = lo[i];
    if (typeof date === 'string' && typeof h === 'number' && typeof l === 'number')
      out.push({ date, highF: h, lowF: l });
  });
  return out;
}

export async function fetchWeather(
  place: Place,
  month: string,
  today: string,
  fetcher: typeof fetch,
): Promise<ReportWeather | null> {
  try {
    const prev = addPeriods(month, -1);
    const lastYear = addPeriods(month, -12);
    const end = periodEnd(month) < today ? periodEnd(month) : today;
    const q = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      start_date: periodStart(lastYear),
      end_date: end,
      daily: 'temperature_2m_max,temperature_2m_min',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
    });
    const res = await fetcher(`https://archive-api.open-meteo.com/v1/archive?${q}`, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const days = parseOpenMeteo(await res.json());
    const cur = monthWeather(days, month);
    if (!cur) return null;
    return { month: cur, prev: monthWeather(days, prev), lastYear: monthWeather(days, lastYear) };
  } catch {
    return null;
  }
}

/** EIA v2 weekly retail price rows as points in cents per gallon. */
export function parseEia(json: unknown): GasPoint[] {
  const rows = (json as { response?: { data?: unknown } } | null)?.response?.data;
  if (!Array.isArray(rows)) return [];
  const out: GasPoint[] = [];
  for (const r of rows as { period?: unknown; value?: unknown }[]) {
    const cents = priceToCents(String(r.value ?? ''));
    if (typeof r.period === 'string' && cents !== null) out.push({ date: r.period, cents });
  }
  return out;
}

export async function fetchGas(
  state: string,
  month: string,
  today: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<ReportGas | null> {
  const region = gasRegionOf(state);
  if (!region) return null;
  try {
    const prev = addPeriods(month, -1);
    const lastYear = addPeriods(month, -12);
    const end = periodEnd(month) < today ? periodEnd(month) : today;
    const q = new URLSearchParams({
      api_key: apiKey,
      frequency: 'weekly',
      'data[0]': 'value',
      'facets[product][]': 'EPMR',
      'facets[duoarea][]': region.code,
      start: periodStart(lastYear),
      end,
      'sort[0][column]': 'period',
      'sort[0][direction]': 'asc',
      length: '120',
    });
    const res = await fetcher(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?${q}`, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const pts = parseEia(await res.json());
    const monthCents = monthGasCents(pts, month);
    if (monthCents === null) return null;
    return {
      region: region.label,
      monthCents,
      prevCents: monthGasCents(pts, prev),
      lastYearCents: monthGasCents(pts, lastYear),
    };
  } catch {
    return null;
  }
}

export interface ContextOptions {
  /** Five digits, or empty for none. */
  zip: string;
  /** EIA key for gas prices; without it the gas section is left out. */
  eiaKey?: string | undefined;
  /** Facts the owner confirmed in earlier months. */
  lifeNotes: readonly string[];
}

export async function fetchContext(
  o: ContextOptions,
  month: string,
  today: string,
  fetcher: typeof fetch,
): Promise<{ weather: ReportWeather | null; gas: ReportGas | null }> {
  if (!/^\d{5}$/.test(o.zip)) return { weather: null, gas: null };
  const place = await lookupZip(o.zip, fetcher);
  if (!place) return { weather: null, gas: null };
  const [weather, gas] = await Promise.all([
    fetchWeather(place, month, today, fetcher),
    o.eiaKey ? fetchGas(place.state, month, today, o.eiaKey, fetcher) : null,
  ]);
  return { weather, gas };
}
