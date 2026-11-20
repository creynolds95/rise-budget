import { z } from 'zod';

/**
 * What the activity log records about an edit. Pure. The rule: structured fields (ids, amounts,
 * flags, dates, enums) are kept with their before and after; free text (notes, names, merchant
 * strings) is only ever "changed", with its length, so the log can be read by anyone the owner
 * lets read it without reproducing what the owner wrote.
 */

export type Scalar = string | number | boolean | null;
export type Snapshot = Record<string, unknown>;

/** Fields whose value is kept. Everything else a snapshot holds is treated as free text. */
export interface FieldRule {
  keep: readonly string[];
  text: readonly string[];
}

export interface FieldChange {
  field: string;
  before?: Scalar;
  after?: Scalar;
  /** Free text: only that it changed, and how long it is now. */
  changed?: true;
  length?: number;
}

const scalar = (v: unknown): Scalar =>
  v === null || v === undefined
    ? null
    : typeof v === 'number' || typeof v === 'boolean'
      ? v
      : typeof v === 'string'
        ? v.slice(0, 80)
        : JSON.stringify(v).slice(0, 200);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields that differ between two snapshots, redacted per `rule`. */
export function diffFields(
  before: Snapshot | null,
  after: Snapshot | null,
  rule: FieldRule,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of rule.keep) {
    const b = before?.[field];
    const a = after?.[field];
    if (!same(a, b)) out.push({ field, before: scalar(b), after: scalar(a) });
  }
  for (const field of rule.text) {
    const b = before?.[field];
    const a = after?.[field];
    if (!same(a, b))
      out.push({
        field,
        changed: true,
        ...(typeof a === 'string' ? { length: a.length } : {}),
      });
  }
  return out;
}

/** The names of the top-level fields a request body carried; never their values. */
export function bodyKeys(body: unknown): string[] {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort().slice(0, 30)
    : [];
}

/** A route pattern from a client-side path: ids and dates collapse so each screen is one row. */
export function clientRoute(path: string): string {
  const [p = ''] = path.split('?');
  return (
    p
      .split('/')
      .map((s) =>
        /^\d{4}-\d{2}(-\d{2})?$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || /^\d+$/.test(s)
          ? ':id'
          : s.slice(0, 40),
      )
      .join('/')
      .slice(0, 80) || '/'
  );
}

/** What the browser reports, batched: per route, how many calls, failures and how long. */
export const ClientPerfBody = z.object({
  samples: z
    .array(
      z.object({
        route: z.string().min(1).max(80),
        n: z.number().int().min(1).max(10_000),
        errors: z.number().int().min(0).max(10_000),
        msTotal: z.number().int().min(0).max(100_000_000),
        msMax: z.number().int().min(0).max(10_000_000),
      }),
    )
    .max(40),
});
export type ClientPerfBody = z.infer<typeof ClientPerfBody>;

/** Slower than this is a "slow" request in the hourly aggregate. */
export const SLOW_REQUEST_MS = 1000;
/** A statement slower than this is kept as a slow-query shape. */
export const SLOW_STATEMENT_MS = 150;
