import type { RolloverPolicy, SpendShape } from '../schemas/enums';

/**
 * Smart defaults on category creation (SPEC §2.2): discretionary → `roll`,
 * bills → `return_to_pool`. Bills are single charges, so they default to `fixed` pace.
 * Explicit choices always win.
 */
export function categoryDefaults(input: {
  isBill: boolean;
  rolloverPolicy?: RolloverPolicy | undefined;
  spendShape?: SpendShape | undefined;
}): { rolloverPolicy: RolloverPolicy; spendShape: SpendShape } {
  return {
    rolloverPolicy: input.rolloverPolicy ?? (input.isBill ? 'return_to_pool' : 'roll'),
    spendShape: input.spendShape ?? (input.isBill ? 'fixed' : 'linear'),
  };
}
