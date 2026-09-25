import { z } from 'zod';

/**
 * SimpleFIN protocol adapter (SPEC §6.1, §6.3). Everything SimpleFIN-specific — its JSON
 * shape, decimal-string amounts, and sign convention — stops here. Pure.
 */

const Decimal = z.string().regex(/^[+-]?\d+(\.\d+)?$/);

export const SimpleFinTransaction = z.object({
  id: z.string().min(1),
  posted: z.number().int(),
  amount: Decimal,
  description: z.string(),
  payee: z.string().optional(),
  memo: z.string().optional(),
  transacted_at: z.number().int().optional(),
  pending: z.boolean().optional(),
});
export type SimpleFinTransaction = z.infer<typeof SimpleFinTransaction>;

export const SimpleFinAccount = z.object({
  org: z.looseObject({ name: z.string().optional(), domain: z.string().optional() }),
  id: z.string().min(1),
  name: z.string(),
  currency: z.string(),
  balance: Decimal,
  'available-balance': Decimal.optional(),
  'balance-date': z.number().int(),
  transactions: z.array(SimpleFinTransaction).default([]),
});
export type SimpleFinAccount = z.infer<typeof SimpleFinAccount>;

export const SimpleFinAccountSet = z.object({
  errors: z.array(z.string()).default([]),
  accounts: z.array(SimpleFinAccount),
});
export type SimpleFinAccountSet = z.infer<typeof SimpleFinAccountSet>;

export class AdapterError extends Error {
  override readonly name = 'AdapterError';
}

/** "−12.34" → −1234. Exact; sub-cent digits that aren't zero are an error, never rounded. */
export function decimalToCents(s: string): number {
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new AdapterError(`Not a decimal amount: ${s}`);
  const frac = m[3] ?? '';
  if (/[1-9]/.test(frac.slice(2))) throw new AdapterError(`Sub-cent amount: ${s}`);
  const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new AdapterError(`Amount out of range: ${s}`);
  return m[1] === '-' ? -cents : cents;
}

/** Unix seconds → the calendar date in the user's timezone. */
export function localDate(unixSeconds: number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

export interface IncomingTxn {
  sourceId: string;
  postedAt: string;
  /** Rise convention: expense positive, income negative (SPEC §1.1). */
  amountCents: number;
  descriptor: string;
  pending: boolean;
}

/**
 * SimpleFIN reports money out as negative for every account type; Rise counts spending as
 * positive, so transaction signs flip here. Balances already follow the person's view
 * (credit negative when owed) and pass through.
 */
export function toIncomingTxn(t: SimpleFinTransaction, timeZone: string): IncomingTxn {
  const when = t.posted > 0 ? t.posted : (t.transacted_at ?? 0);
  return {
    sourceId: t.id,
    postedAt: localDate(when, timeZone),
    amountCents: -decimalToCents(t.amount),
    descriptor: t.description.trim() || (t.payee ?? '').trim() || 'Unknown',
    pending: t.pending === true || t.posted === 0,
  };
}

export type GuessedKind = 'depository' | 'credit' | 'loan' | 'investment';

export interface IncomingAccount {
  sourceAccountId: string;
  name: string;
  institutionName: string | null;
  kind: GuessedKind;
  balanceCents: number;
  balanceDate: string;
  /** Savings is a net-worth item (SPEC §5.1). */
  includeInBudget: boolean;
  /** Apple refreshes monthly; most banks daily (SPEC §5.1). Editable afterwards. */
  syncCadenceHours: number;
}

/**
 * SimpleFIN carries no account type, so a new account's kind is a first guess from its
 * name and balance. The user can correct it; it's never re-guessed for an existing account.
 */
export function toIncomingAccount(a: SimpleFinAccount, timeZone: string): IncomingAccount {
  if (a.currency !== 'USD') throw new AdapterError(`Unsupported currency ${a.currency}`);
  const balanceCents = decimalToCents(a.balance);
  const kind: GuessedKind = /\b(loan|mortgage|heloc|installment|financing)\b/i.test(a.name)
    ? 'loan'
    : /\b(401\s?\(?k\)?|403\s?b|ira|roth|retirement|pension|brokerage|investment)\b/i.test(a.name)
      ? 'investment'
      : /\b(credit|card|visa|mastercard|amex)\b/i.test(a.name) || balanceCents < 0
        ? 'credit'
        : 'depository';
  const institutionName = a.org.name ?? a.org.domain ?? null;
  return {
    sourceAccountId: a.id,
    name: a.name,
    institutionName,
    kind,
    balanceCents,
    balanceDate: localDate(a['balance-date'], timeZone),
    includeInBudget:
      kind !== 'investment' && !(kind === 'depository' && /\bsavings\b/i.test(a.name)),
    syncCadenceHours: /\bapple\b/i.test(`${institutionName ?? ''} ${a.name}`) ? 720 : 24,
  };
}
