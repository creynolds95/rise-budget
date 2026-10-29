import type { Cents } from '../budget/money';
import type { IsoDate } from '../budget/period';
import type { TaxKind } from '../schemas/enums';

/** Income kinds are stored as negative spending (SPEC §1.1); the pack shows them as earned. */
export const INCOME_TAX_KINDS: ReadonlySet<TaxKind> = new Set(['income_1099', 'income_other']);

export interface TaxRowInput {
  txnId: string;
  postedAt: IsoDate;
  merchant: string;
  accountId: string;
  amountCents: Cents;
  kind: TaxKind;
  source: string;
}

/**
 * The year's tax lines from what categories and tags marked. A category marks the split filed
 * there; a tag marks the whole transaction. One transaction never counts twice under the same
 * heading: when its category already put it there, a tag with that same kind adds nothing.
 * Sorted by date, then transaction, so the CSV reads like a ledger.
 */
export function taxLines(
  byCategory: readonly TaxRowInput[],
  byTag: readonly TaxRowInput[],
): TaxRowInput[] {
  const seen = new Set(byCategory.map((r) => `${r.txnId}|${r.kind}`));
  const out = [...byCategory];
  for (const r of byTag) {
    const key = `${r.txnId}|${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort(
    (a, b) =>
      a.postedAt.localeCompare(b.postedAt) ||
      a.txnId.localeCompare(b.txnId) ||
      a.kind.localeCompare(b.kind),
  );
}

export interface TaxHeading {
  kind: TaxKind;
  /** Earned for income kinds, spent for the rest: positive in the normal case. */
  totalCents: Cents;
  count: number;
  sources: { source: string; totalCents: Cents; count: number }[];
}

/** Totals per heading and per category/tag inside it, biggest first. */
export function taxSummary(lines: readonly TaxRowInput[]): TaxHeading[] {
  const byKind = new Map<TaxKind, TaxHeading>();
  for (const l of lines) {
    const cents = INCOME_TAX_KINDS.has(l.kind) ? -l.amountCents : l.amountCents;
    let h = byKind.get(l.kind);
    if (!h) {
      h = { kind: l.kind, totalCents: 0, count: 0, sources: [] };
      byKind.set(l.kind, h);
    }
    h.totalCents += cents;
    h.count += 1;
    let s = h.sources.find((x) => x.source === l.source);
    if (!s) {
      s = { source: l.source, totalCents: 0, count: 0 };
      h.sources.push(s);
    }
    s.totalCents += cents;
    s.count += 1;
  }
  const heads = [...byKind.values()];
  for (const h of heads) h.sources.sort((a, b) => b.totalCents - a.totalCents);
  return heads.sort((a, b) => b.totalCents - a.totalCents);
}

const cell = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
const dollars = (c: Cents) =>
  `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

/**
 * The pack as CSV for a tax preparer. Amounts read the way the heading means them: income as
 * earned, the rest as paid. Text cells are quoted, and one that starts like a formula gets an
 * apostrophe so a spreadsheet never runs it.
 */
export function taxCsv(
  lines: readonly TaxRowInput[],
  labels: { kind: (k: TaxKind) => string; account: (id: string) => string },
): string {
  const rows = lines.map((l) =>
    [
      l.postedAt,
      cell(labels.kind(l.kind)),
      cell(l.source),
      cell(l.merchant),
      cell(labels.account(l.accountId)),
      dollars(INCOME_TAX_KINDS.has(l.kind) ? -l.amountCents : l.amountCents),
    ].join(','),
  );
  return ['Date,Heading,Category or tag,Merchant,Account,Amount', ...rows].join('\n') + '\n';
}
