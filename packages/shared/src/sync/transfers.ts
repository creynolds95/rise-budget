import { dayNumber } from '../networth';

/**
 * Transfer detection (SPEC §3.3, §3.4). Pure. Money moving between the user's own accounts
 * is neither income nor spending — above all, paying a credit card from checking.
 */

export interface TransferCandidate {
  id: string;
  accountId: string;
  accountKind: string;
  postedAt: string;
  amountCents: number;
}

export interface TransferPair {
  a: string;
  b: string;
  confidence: 'high' | 'medium';
  dayGap: number;
}

export const TRANSFER_MAX_DAYS = 4;

export function pairConfidence(
  a: TransferCandidate,
  b: TransferCandidate,
): TransferPair['confidence'] | null {
  if (a.accountId === b.accountId || a.amountCents === 0 || a.amountCents !== -b.amountCents)
    return null;
  const gap = Math.abs(dayNumber(a.postedAt) - dayNumber(b.postedAt));
  if (gap > TRANSFER_MAX_DAYS) return null;
  const kinds = new Set([a.accountKind, b.accountKind]);
  return gap <= 1 && kinds.has('credit') && kinds.has('depository') ? 'high' : 'medium';
}

/**
 * Pairs unpaired rows greedily, best first: high before medium, then the closest dates,
 * then ids, so the result doesn't depend on input order.
 */
export function detectTransfers(rows: readonly TransferCandidate[]): TransferPair[] {
  const all: TransferPair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i] as TransferCandidate;
      const b = rows[j] as TransferCandidate;
      const confidence = pairConfidence(a, b);
      if (!confidence) continue;
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      all.push({
        a: x,
        b: y,
        confidence,
        dayGap: Math.abs(dayNumber(a.postedAt) - dayNumber(b.postedAt)),
      });
    }
  }
  all.sort(
    (p, q) =>
      (p.confidence === q.confidence ? 0 : p.confidence === 'high' ? -1 : 1) ||
      p.dayGap - q.dayGap ||
      p.a.localeCompare(q.a) ||
      p.b.localeCompare(q.b),
  );
  const used = new Set<string>();
  const out: TransferPair[] = [];
  for (const p of all) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a);
    used.add(p.b);
    out.push(p);
  }
  return out;
}
