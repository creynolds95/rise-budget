import { addMonths, monthEnd, shortDate } from './dates';
import { formatCents } from './money';

export const DATE_PRESETS = [
  { id: 'all', label: 'All time' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' },
  { id: 'ytd', label: 'This year' },
  { id: 'custom', label: 'Custom' },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]['id'];

export const SORTS = [
  { id: 'date_desc', label: 'Date, newest first' },
  { id: 'date_asc', label: 'Date, oldest first' },
  { id: 'amount_desc', label: 'Amount, largest first' },
  { id: 'amount_asc', label: 'Amount, smallest first' },
] as const;
export type SortId = (typeof SORTS)[number]['id'];

export type Direction = 'any' | 'out' | 'in';
export type ReviewFilter = 'any' | 'needs_review' | 'reviewed' | 'dropped';

/** Everything the Transactions tab can filter on. Lives in the URL. */
export interface Filters {
  q: string;
  range: DatePreset;
  from: string;
  to: string;
  accounts: string[];
  categories: string[];
  direction: Direction;
  minCents: number | null;
  maxCents: number | null;
  sort: SortId;
  review: ReviewFilter;
}

export const EMPTY: Filters = {
  q: '',
  range: 'all',
  from: '',
  to: '',
  accounts: [],
  categories: [],
  direction: 'any',
  minCents: null,
  maxCents: null,
  sort: 'date_desc',
  review: 'any',
};

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const cents = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
const oneOf = <T extends string>(v: string | null, ok: readonly T[], d: T): T =>
  ok.includes(v as T) ? (v as T) : d;

export function parseFilters(p: URLSearchParams): Filters {
  return {
    q: p.get('q') ?? '',
    range: oneOf(
      p.get('range'),
      DATE_PRESETS.map((d) => d.id),
      p.get('from') || p.get('to') ? 'custom' : 'all',
    ),
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    accounts: list(p.get('account')),
    categories: list(p.get('category')),
    direction: oneOf(p.get('direction'), ['any', 'out', 'in'] as const, 'any'),
    minCents: cents(p.get('min')),
    maxCents: cents(p.get('max')),
    sort: oneOf(
      p.get('sort'),
      SORTS.map((s) => s.id),
      'date_desc',
    ),
    review: oneOf(
      p.get('reviewState'),
      ['any', 'needs_review', 'reviewed', 'dropped'] as const,
      'any',
    ),
  };
}

/** Back to URL params, leaving out anything at its default so links stay short. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  } else if (f.range !== 'all') p.set('range', f.range);
  if (f.accounts.length) p.set('account', f.accounts.join(','));
  if (f.categories.length) p.set('category', f.categories.join(','));
  if (f.direction !== 'any') p.set('direction', f.direction);
  if (f.minCents !== null) p.set('min', String(f.minCents));
  if (f.maxCents !== null) p.set('max', String(f.maxCents));
  if (f.sort !== 'date_desc') p.set('sort', f.sort);
  if (f.review !== 'any') p.set('reviewState', f.review);
  return p;
}

/** The dates a preset covers, relative to today. */
export function dateBounds(f: Filters, today: string): { from?: string; to?: string } {
  const month = today.slice(0, 7);
  switch (f.range) {
    case 'all':
      return {};
    case 'this-month':
      return { from: `${month}-01`, to: today };
    case 'last-month': {
      const m = addMonths(month, -1);
      return { from: `${m}-01`, to: monthEnd(m) };
    }
    case '3m':
      return { from: `${addMonths(month, -2)}-01`, to: today };
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return { ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) };
  }
}

/** The query string the API takes. */
export function apiQuery(f: Filters, today: string): Record<string, string> {
  const out: Record<string, string> = { ...dateBounds(f, today) };
  if (f.q.trim()) out.q = f.q.trim();
  if (f.accounts.length) out.account = f.accounts.join(',');
  if (f.categories.length) out.category = f.categories.join(',');
  if (f.direction !== 'any') out.direction = f.direction;
  if (f.minCents !== null) out.min = String(f.minCents);
  if (f.maxCents !== null) out.max = String(f.maxCents);
  if (f.sort !== 'date_desc') out.sort = f.sort;
  if (f.review !== 'any') out.reviewState = f.review;
  return out;
}

export interface Chip {
  key: string;
  label: string;
  clear: (f: Filters) => Filters;
}

/** One removable chip per active filter (search has its own field, so it gets none). */
export function chips(
  f: Filters,
  names: { account: (id: string) => string; category: (id: string) => string },
): Chip[] {
  const out: Chip[] = [];
  if (f.range !== 'all' && !(f.range === 'custom' && !f.from && !f.to)) {
    const label =
      f.range === 'custom'
        ? f.from && f.to
          ? `${shortDate(f.from)} – ${shortDate(f.to)}`
          : f.from
            ? `Since ${shortDate(f.from)}`
            : `Until ${shortDate(f.to)}`
        : (DATE_PRESETS.find((d) => d.id === f.range)?.label ?? '');
    out.push({ key: 'range', label, clear: (x) => ({ ...x, range: 'all', from: '', to: '' }) });
  }
  const many = (ids: string[], name: (id: string) => string) =>
    ids.length === 1 ? name(ids[0] as string) : `${name(ids[0] as string)} +${ids.length - 1}`;
  if (f.accounts.length)
    out.push({
      key: 'accounts',
      label: many(f.accounts, names.account),
      clear: (x) => ({ ...x, accounts: [] }),
    });
  if (f.categories.length)
    out.push({
      key: 'categories',
      label: many(f.categories, names.category),
      clear: (x) => ({ ...x, categories: [] }),
    });
  if (f.direction !== 'any')
    out.push({
      key: 'direction',
      label: f.direction === 'out' ? 'Spending' : 'Money in',
      clear: (x) => ({ ...x, direction: 'any' }),
    });
  if (f.minCents !== null || f.maxCents !== null) {
    const w = (c: number) => formatCents(c, { whole: c % 100 === 0 });
    const label =
      f.minCents !== null && f.maxCents !== null
        ? `${w(f.minCents)} – ${w(f.maxCents)}`
        : f.minCents !== null
          ? `Over ${w(f.minCents)}`
          : `Under ${w(f.maxCents as number)}`;
    out.push({
      key: 'amount',
      label,
      clear: (x) => ({ ...x, minCents: null, maxCents: null }),
    });
  }
  if (f.review !== 'any')
    out.push({
      key: 'review',
      label: { needs_review: 'To review', reviewed: 'Reviewed', dropped: 'Never posted' }[f.review],
      clear: (x) => ({ ...x, review: 'any' }),
    });
  if (f.sort !== 'date_desc')
    out.push({
      key: 'sort',
      label: SORTS.find((s) => s.id === f.sort)?.label ?? '',
      clear: (x) => ({ ...x, sort: 'date_desc' }),
    });
  return out;
}

/** "Today", "Yesterday", "Thu, Sep 18", or with the year when it isn't this one. */
export function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const base = `${wd}, ${shortDate(date)}`;
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${base}, ${date.slice(0, 4)}`;
}

/** Consecutive rows that share a date, for date headers in a date-sorted list. */
export function groupByDay<T extends { postedAt: string }>(items: T[]): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const t of items) {
    const last = out.at(-1);
    if (last && last[0] === t.postedAt) last[1].push(t);
    else out.push([t.postedAt, [t]]);
  }
  return out;
}
