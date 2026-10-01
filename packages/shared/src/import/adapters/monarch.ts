import { AdapterError, decimalToCents } from './simplefin';

/** The columns of Monarch's Transactions export. */
export const MONARCH_COLUMNS = [
  'Date',
  'Merchant',
  'Category',
  'Account',
  'Original Statement',
  'Notes',
  'Amount',
  'Tags',
  'Owner',
  'Reviewed',
  'Id',
] as const;

/**
 * RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines. A leading byte-order
 * mark is dropped and blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let touched = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (touched) rows.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      touched = true;
    } else if (ch === ',') {
      touched = true;
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      touched = true;
      field += ch;
    }
  }
  if (quoted) throw new AdapterError('CSV ends inside a quote');
  endRow();
  return rows;
}

export type MonarchReviewState = 'reviewed' | 'needs_review' | 'unreviewed';

/** One Monarch transaction in Rise's terms (SPEC §1.1: expense positive, income negative). */
export interface MonarchRow {
  /** `monarch:<Id>`. Monarch's id is the only safe dedupe key: real repeat purchases share every other field. */
  sourceId: string;
  postedAt: string;
  amountCents: number;
  merchant: string;
  originalStatement: string;
  category: string;
  account: string;
  notes: string;
  tags: string[];
  reviewed: MonarchReviewState;
}

export interface MonarchParseError {
  /** 1-based, counting the header as line 1. */
  line: number;
  message: string;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const REVIEW: Record<string, MonarchReviewState> = {
  Reviewed: 'reviewed',
  'Needs Review': 'needs_review',
};

/**
 * Parse a Monarch Transactions export. A bad row is reported by line and skipped so the
 * preview can show it; a file that isn't a Monarch export at all throws.
 */
export function parseMonarchCsv(text: string): { rows: MonarchRow[]; errors: MonarchParseError[] } {
  const [first, ...body] = parseCsv(text);
  const head = first ?? [];
  const col = new Map(head.map((name, i) => [name.trim(), i]));
  const missing = MONARCH_COLUMNS.filter((c) => !col.has(c));
  if (missing.length > 0)
    throw new AdapterError(`Not a Monarch export: missing column ${missing.join(', ')}`);
  const at = (cells: string[], name: (typeof MONARCH_COLUMNS)[number]) =>
    (cells[col.get(name) as number] as string).trim();

  const rows: MonarchRow[] = [];
  const errors: MonarchParseError[] = [];
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const fail = (message: string) => errors.push({ line, message });
    if (cells.length < head.length) return fail('Row has too few columns');
    const date = at(cells, 'Date');
    if (!isRealDate(date)) return fail(`Bad date: ${date}`);
    let amountCents: number;
    try {
      amountCents = -decimalToCents(at(cells, 'Amount'));
    } catch (e) {
      return fail(`Bad amount: ${(e as Error).message}`);
    }
    const id = at(cells, 'Id');
    if (!id) return fail('Missing id');
    if (seen.has(id)) return fail(`Duplicate id ${id}`);
    seen.add(id);
    const originalStatement = at(cells, 'Original Statement');
    rows.push({
      sourceId: `monarch:${id}`,
      postedAt: date,
      amountCents,
      merchant: at(cells, 'Merchant') || originalStatement || 'Unknown',
      originalStatement,
      category: at(cells, 'Category'),
      account: at(cells, 'Account'),
      notes: at(cells, 'Notes'),
      tags: at(cells, 'Tags')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      reviewed: REVIEW[at(cells, 'Reviewed')] ?? 'unreviewed',
    });
  });
  return { rows, errors };
}
