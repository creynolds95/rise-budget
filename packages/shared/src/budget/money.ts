/**
 * Integer-cent money primitives. SPEC §0: money is integer cents, never floats.
 *
 * Every function here takes and returns safe integers. Anything that divides does so
 * with BigInt and an explicit rounding rule, so no binary-float residue can leak in.
 */

import type { Cents } from '../schemas/primitives';

export type { Cents };

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function isCents(n: unknown): n is Cents {
  return Number.isSafeInteger(n);
}

export function assertCents(n: number, label = 'amount'): Cents {
  if (!isCents(n)) throw new MoneyError(`${label} must be integer cents, got ${n}`);
  return n;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'sum');
}

/**
 * `cents * num / den`, rounded half away from zero, in exact integer arithmetic.
 * Used for pace projections (e.g. available × remaining days / days in period).
 */
export function mulDiv(cents: Cents, num: number, den: number): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
    throw new MoneyError(`mulDiv needs integer num/den with den ≠ 0, got ${num}/${den}`);
  }
  const n = BigInt(cents) * BigInt(num);
  const d = BigInt(den);
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  return Number(negative ? -q : q);
}

/**
 * Split `total` into integer parts proportional to non-negative integer `weights`,
 * using the largest-remainder method. The parts always sum to exactly `total`.
 * Ties on remainder go to the earlier index, so the result is deterministic.
 */
export function allocateByWeights(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, 'total');
  if (weights.length === 0) throw new MoneyError('allocateByWeights needs at least one weight');
  let weightSum = 0n;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new MoneyError(`weights must be non-negative integers, got ${w}`);
    }
    weightSum += BigInt(w);
  }
  if (weightSum === 0n) throw new MoneyError('weights must not all be zero');

  const sign = total < 0 ? -1n : 1n;
  const abs = BigInt(total) * sign;
  const floors: bigint[] = [];
  const rems: { i: number; r: bigint }[] = [];
  let assigned = 0n;
  weights.forEach((w, i) => {
    const p = abs * BigInt(w);
    const f = p / weightSum;
    floors.push(f);
    rems.push({ i, r: p % weightSum });
    assigned += f;
  });
  let left = abs - assigned;
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rems) {
    if (left === 0n) break;
    floors[i] = (floors[i] as bigint) + 1n;
    left -= 1n;
  }
  return floors.map((f) => Number(f * sign));
}
