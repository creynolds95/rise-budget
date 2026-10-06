import { formatBalance, formatCents, type FormatOptions } from '../../lib/money';

const TONE = {
  ink: 'text-ink',
  muted: 'text-ink-muted',
  /** Overspend and carried deficits. Never red (DESIGN-SYSTEM.md §1). */
  over: 'text-clay',
  /** Money coming in. */
  in: 'text-sage-700',
} as const;

export type MoneyTone = keyof typeof TONE;

/** Every monetary figure goes through here, so every one is tabular (§2). */
export function MoneyText({
  cents,
  tone = 'ink',
  className = '',
  balance = false,
  ...format
}: {
  cents: number;
  tone?: MoneyTone;
  className?: string;
  /** A budget balance: whole dollars, except an overspend under $1 (see formatBalance). */
  balance?: boolean;
} & FormatOptions) {
  return (
    <span className={`money whitespace-nowrap ${TONE[tone]} ${className}`} data-cents={cents}>
      {balance ? formatBalance(cents, format) : formatCents(cents, format)}
    </span>
  );
}
