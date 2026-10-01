import { assertCents, sumCents, type Cents } from './money';

export interface PoolInput {
  expectedIncomeCents: Cents;
  /** `planned` for every expense category in P. */
  plannedCents: readonly Cents[];
}

/**
 * SPEC §2.3. Derived, never stored. May be negative — a negative pool is over-allocation
 * and is returned as-is, never clamped (edge 14). With no allocations, pool = income.
 */
export function pool(input: PoolInput): Cents {
  return (
    assertCents(input.expectedIncomeCents, 'expectedIncomeCents') - sumCents(input.plannedCents)
  );
}
