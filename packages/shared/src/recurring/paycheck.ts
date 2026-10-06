/** Where a paycheck's gross goes before it reaches checking. Informational; never feeds the budget. */
export const DEDUCTION_KINDS = ['tax', 'retirement', 'health', 'other'] as const;
export type DeductionKind = (typeof DEDUCTION_KINDS)[number];

export interface PaycheckLine {
  label: string;
  kind: DeductionKind;
  amountCents: number;
  /** What this line becomes once the schedule's amount change takes effect; absent = unchanged. */
  nextAmountCents?: number | undefined;
}

export interface PaycheckBreakdown {
  grossCents: number;
  nextGrossCents?: number | undefined;
  lines: readonly PaycheckLine[];
}

/** Gross minus every deduction: the deposit this breakdown adds up to. Pure. */
export function paycheckNet(b: PaycheckBreakdown): number {
  return b.grossCents - b.lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/** The same paycheck once the pending change applies. Unset fields carry over. Pure. */
export function paycheckNetAfter(b: PaycheckBreakdown): number {
  return (
    (b.nextGrossCents ?? b.grossCents) -
    b.lines.reduce((sum, l) => sum + (l.nextAmountCents ?? l.amountCents), 0)
  );
}

/** Deductions summed per kind, in kind order, skipping kinds with nothing in them. Pure. */
export function deductionTotals(
  b: PaycheckBreakdown,
): { kind: DeductionKind; amountCents: number }[] {
  return DEDUCTION_KINDS.map((kind) => ({
    kind,
    amountCents: b.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amountCents, 0),
  })).filter((t) => t.amountCents > 0);
}

/** The breakdown with its pending change made current (the schedule has reached the date). Pure. */
export function foldPaycheck(b: PaycheckBreakdown): PaycheckBreakdown {
  return {
    grossCents: b.nextGrossCents ?? b.grossCents,
    lines: b.lines.map((l) => ({
      label: l.label,
      kind: l.kind,
      amountCents: l.nextAmountCents ?? l.amountCents,
    })),
  };
}
