import type { Transaction } from '@rise/shared/schemas';
import { MoneyText } from './primitives/MoneyText';

/**
 * A transaction's amount as people read it: spending is a plain number, money in carries a
 * plus and the "in" tone, a transfer is muted. No minus sign on every purchase.
 */
export function TxnAmount({
  t,
  className = '',
}: {
  t: Pick<Transaction, 'amountCents' | 'isTransfer'>;
  className?: string;
}) {
  if (t.isTransfer)
    return <MoneyText cents={Math.abs(t.amountCents)} tone="muted" className={className} />;
  if (t.amountCents < 0)
    return <MoneyText cents={-t.amountCents} sign="always" tone="in" className={className} />;
  return <MoneyText cents={t.amountCents} className={className} />;
}
