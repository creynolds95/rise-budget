import { addPeriods } from '../budget/period';
import {
  ReportData,
  buildBenchmarks,
  buildCategories,
  cashStatus,
  isPrevSparse,
  changelogFor,
  topMovers,
  BENCHMARK_YEAR,
  type RawCategory,
} from './index';

/**
 * The report's figures from a transaction CSV export (Date, Category, Amount columns; money in
 * is positive, money out negative). Used to try the report on historical data without the
 * live database. Pure. A CSV has no balances or goals, so net worth and goals come back empty
 * and the report simply leaves those sections out.
 */

/** RFC 4180 fields: quoted values, doubled quotes, CRLF or LF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** "-1234.5" → -123450 in integer math; null when it is not a plain decimal. */
export function amountToCents(s: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -cents : cents;
}

export interface CsvTxn {
  /** YYYY-MM-DD */
  date: string;
  category: string;
  cents: number;
}

export function csvTxns(text: string): CsvTxn[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const [d, c, a] = [col('date'), col('category'), col('amount')];
  if (d < 0 || c < 0 || a < 0) throw new Error('CSV needs Date, Category and Amount columns');
  return rows.flatMap((r) => {
    const cents = amountToCents(r[a] ?? '');
    const date = r[d] ?? '';
    return cents === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? []
      : [{ date, category: r[c] ?? '', cents }];
  });
}

/** Moves between the owner's own accounts and card payments: never spending, never income. */
export const isTransferCategory = (name: string): boolean =>
  /^(transfer|credit card payment)/i.test(name.trim());

export function reportDataFromCsv(txns: readonly CsvTxn[], month: string): ReportData {
  const prev = addPeriods(month, -1);
  const lastYear = addPeriods(month, -12);
  const real = txns.filter((t) => !isTransferCategory(t.category));

  // A category is income when its whole history nets positive (paychecks), expense otherwise.
  // Judging per month would turn a month of refunds in a spending category into "income".
  const lifetime = new Map<string, number>();
  for (const t of real) lifetime.set(t.category, (lifetime.get(t.category) ?? 0) + t.cents);
  const isIncome = (cat: string) => (lifetime.get(cat) ?? 0) > 0;

  const month_ = (m: string) => {
    const net = new Map<string, number>();
    let count = 0;
    let income = 0;
    for (const t of real) {
      if (!t.date.startsWith(m)) continue;
      count++;
      if (isIncome(t.category)) income += t.cents;
      else net.set(t.category, (net.get(t.category) ?? 0) - t.cents);
    }
    const rows: RawCategory[] = [...net].map(([name, cents]) => ({ name, cents }));
    return { rows, count, income, spent: rows.reduce((n, r) => n + r.cents, 0) };
  };
  const cur = month_(month);
  const old = month_(prev);
  const ly = month_(lastYear);
  const categories = buildCategories(cur.rows, old.rows, ly.count > 0 ? ly.rows : null);
  const netCents = cur.income - cur.spent;

  return ReportData.parse({
    month,
    partial: false,
    prevMonth: prev,
    prevSparse: isPrevSparse(old.count, cur.count),
    cash: {
      incomeCents: cur.income,
      spentCents: cur.spent,
      netCents,
      prevIncomeCents: old.income,
      prevSpentCents: old.spent,
      status: cashStatus(netCents),
    },
    categories,
    movers: topMovers(categories),
    benchmarks: { year: BENCHMARK_YEAR, rows: buildBenchmarks(cur.rows, cur.spent) },
    netWorth: {
      startCents: 0,
      endCents: 0,
      changeCents: 0,
      bridge: { contributionsCents: 0, marketCents: 0, debtPaydownCents: 0, otherCents: 0 },
      contributionsTracked: false,
      sp500Bp: null,
      bondsBp: null,
      investmentGrowthBp: null,
    },
    goals: [],
    whatsNew: changelogFor(month),
  });
}
