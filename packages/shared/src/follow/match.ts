/** A manual account that follows transfers: a posted row whose text contains `match` moves
 *  its balance by the row's amount. `since` keeps history from ever changing. */
export interface FollowRule {
  accountId: string;
  /** Lowercase text to look for in the row's descriptor and merchant. */
  match: string;
  /** "YYYY-MM-DD": only rows posted on or after this day are followed. */
  since: string;
}

export interface FollowTxn {
  id: string;
  accountId: string;
  postedAt: string;
  /** Spending positive: money leaving the row's account. */
  amountCents: number;
  /** Lowercase descriptor and merchant text. */
  text: string;
}

export interface FollowMove {
  txnId: string;
  accountId: string;
  /** Money out of the source account is money into the followed one. */
  deltaCents: number;
  postedAt: string;
}

/** Which rows move which followed account. Each row is used once, by the first rule it fits. */
export function planFollowMoves(rules: FollowRule[], txns: FollowTxn[]): FollowMove[] {
  const moves: FollowMove[] = [];
  for (const t of txns) {
    if (t.amountCents === 0) continue;
    const rule = rules.find(
      (r) => r.accountId !== t.accountId && t.postedAt >= r.since && t.text.includes(r.match),
    );
    if (rule)
      moves.push({
        txnId: t.id,
        accountId: rule.accountId,
        deltaCents: t.amountCents,
        postedAt: t.postedAt,
      });
  }
  return moves;
}
