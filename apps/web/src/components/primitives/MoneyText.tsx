import { formatCents, type FormatOptions } from '../../lib/money';

const TONE = {
  ink: 'text-ink',
  muted: 'text-ink-muted',
  /** Overspend and carried deficits. Never red (DESIGN-SYSTEM.md §1). */
  over: 'text-clay',
} as const;

export type MoneyTone = keyof typeof TONE;

/** Every monetary figure goes through here, so every one is tabular (§2). */
export function MoneyText({
  cents,
  tone = 'ink',
  className = '',
  ...format
}: { cents: number; tone?: MoneyTone; className?: string } & FormatOptions) {
  return (
    <span className={`money ${TONE[tone]} ${className}`} data-cents={cents}>
      {formatCents(cents, format)}
    </span>
  );
}
