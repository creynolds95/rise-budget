import type { MonarchRow } from './adapters/monarch';

/** Monarch rows before this date, or after it, are left out: SimpleFIN holds everything newer. */
export interface ImportWindow {
  from: string;
  to: string;
}

/** Monarch's own bookkeeping rows, not spending. */
export const SKIPPED_CATEGORIES = ['Balance Adjustments'];

const TRANSFER_NAMES = /^(transfer|credit card payment)$/i;

export interface AccountRef {
  id: string;
  name: string;
}
export interface CategoryRef {
  id: string;
  name: string;
}

export type GuessedAccountKind = 'depository' | 'credit' | 'loan';
export type CategoryKind = 'income' | 'expense' | 'transfer';

export type AccountChoice =
  { type: 'existing'; accountId: string } | { type: 'create'; kind: GuessedAccountKind };
export type CategoryChoice =
  { type: 'existing'; categoryId: string } | { type: 'create'; kind: CategoryKind };

export interface AccountPlan {
  monarchName: string;
  rows: number;
  first: string;
  last: string;
  /** Matched to an account Rise already has; otherwise it would be created as history-only. */
  matched: boolean;
  choice: AccountChoice;
}
export interface CategoryPlan {
  monarchName: string;
  rows: number;
  matched: boolean;
  choice: CategoryChoice;
}

export interface MonarchPlan {
  rows: MonarchRow[];
  skipped: { outsideWindow: number; categories: Record<string, number> };
  accounts: AccountPlan[];
  categories: CategoryPlan[];
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** "(...4821)", "(4821)" or "(...5502-LN0001)": the part that survives renames between providers. */
export const maskOf = (s: string) =>
  /\((?:\.\.\.)?([\w-]{3,})\)\s*$/.exec(s.trim())?.[1]?.toLowerCase() ?? null;

export function guessAccountKind(name: string): GuessedAccountKind {
  if (/loan|mortgage/i.test(name)) return 'loan';
  if (/credit|card|visa|mastercard|amex/i.test(name)) return 'credit';
  return 'depository';
}

function matchAccount(name: string, existing: AccountRef[]): AccountRef | null {
  const k = key(name);
  const exact = existing.filter((a) => key(a.name) === k);
  if (exact.length === 1) return exact[0] as AccountRef;
  const mask = maskOf(name);
  if (!mask) return null;
  const byMask = existing.filter((a) => maskOf(a.name) === mask);
  return byMask.length === 1 ? (byMask[0] as AccountRef) : null;
}

/**
 * What an import of these rows would do: which rows are in scope, and for every Monarch
 * account and category the best match among what Rise already has. Nothing here is final;
 * the person reviews and can change every choice before anything is written.
 */
export function planMonarchImport(
  all: MonarchRow[],
  accounts: AccountRef[],
  categories: CategoryRef[],
  window: ImportWindow,
): MonarchPlan {
  const skipped = { outsideWindow: 0, categories: {} as Record<string, number> };
  const rows: MonarchRow[] = [];
  for (const r of all) {
    if (r.postedAt < window.from || r.postedAt > window.to) skipped.outsideWindow++;
    else if (SKIPPED_CATEGORIES.includes(r.category))
      skipped.categories[r.category] = (skipped.categories[r.category] ?? 0) + 1;
    else rows.push(r);
  }

  const byAccount = new Map<string, MonarchRow[]>();
  const byCategory = new Map<string, MonarchRow[]>();
  for (const r of rows) {
    byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r]);
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  }

  const accountPlans: AccountPlan[] = [...byAccount.entries()].map(([monarchName, rs]) => {
    const dates = rs.map((r) => r.postedAt).sort();
    const hit = matchAccount(monarchName, accounts);
    return {
      monarchName,
      rows: rs.length,
      first: dates[0] as string,
      last: dates[dates.length - 1] as string,
      matched: hit !== null,
      choice: hit
        ? { type: 'existing', accountId: hit.id }
        : { type: 'create', kind: guessAccountKind(monarchName) },
    };
  });

  const categoryPlans: CategoryPlan[] = [...byCategory.entries()].map(([monarchName, rs]) => {
    const hits = categories.filter((c) => key(c.name) === key(monarchName));
    const hit = hits.length === 1 ? (hits[0] as CategoryRef) : null;
    const kind: CategoryKind = TRANSFER_NAMES.test(monarchName)
      ? 'transfer'
      : rs.every((r) => r.amountCents < 0)
        ? 'income'
        : 'expense';
    return {
      monarchName,
      rows: rs.length,
      matched: hit !== null,
      choice: hit ? { type: 'existing', categoryId: hit.id } : { type: 'create', kind },
    };
  });

  const order = (a: { rows: number }, b: { rows: number }) => b.rows - a.rows;
  return {
    rows,
    skipped,
    accounts: accountPlans.sort(order),
    categories: categoryPlans.sort(order),
  };
}

/** One row as the API stores it: every account and category already resolved to a Rise id. */
export interface ImportRow {
  sourceId: string;
  postedAt: string;
  amountCents: number;
  merchant: string;
  originalStatement: string;
  notes: string;
  accountId: string;
  categoryId: string;
  isTransfer: boolean;
  reviewed: boolean;
}

/** Attach Rise ids to the planned rows; a row whose account or category has no id is left out. */
export function toImportRows(
  rows: MonarchRow[],
  accountIds: ReadonlyMap<string, string>,
  categoryIds: ReadonlyMap<string, string>,
): { rows: ImportRow[]; unresolved: number } {
  const out: ImportRow[] = [];
  let unresolved = 0;
  for (const r of rows) {
    const accountId = accountIds.get(r.account);
    const categoryId = categoryIds.get(r.category);
    if (!accountId || !categoryId) {
      unresolved++;
      continue;
    }
    out.push({
      sourceId: r.sourceId,
      postedAt: r.postedAt,
      amountCents: r.amountCents,
      merchant: r.merchant,
      originalStatement: r.originalStatement,
      notes: r.notes,
      accountId,
      categoryId,
      isTransfer: TRANSFER_NAMES.test(r.category),
      // Monarch's own "Needs Review" stays in Rise's review queue; the rest are settled history.
      reviewed: r.reviewed !== 'needs_review',
    });
  }
  return { rows: out, unresolved };
}

/** Rows that look like one purchase entered twice: same account, day, amount and merchant. */
export interface DuplicateGroup {
  account: string;
  postedAt: string;
  amountCents: number;
  merchant: string;
  /** In file order; the first is the one to keep if the person skips the extras. */
  sourceIds: string[];
}

/**
 * Monarch ids are all distinct, so two identical-looking rows may be a real repeat (the same
 * monthly gift twice in one day) or a double sync. That's the person's call, never ours.
 */
export function possibleDuplicates(rows: MonarchRow[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const k = [r.account, r.postedAt, r.amountCents, key(r.merchant)].join('|');
    const g = groups.get(k);
    if (g) g.sourceIds.push(r.sourceId);
    else
      groups.set(k, {
        account: r.account,
        postedAt: r.postedAt,
        amountCents: r.amountCents,
        merchant: r.merchant,
        sourceIds: [r.sourceId],
      });
  }
  return [...groups.values()]
    .filter((g) => g.sourceIds.length > 1)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
