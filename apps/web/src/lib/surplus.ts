/** Surplus is green, a shortfall is clay (the app's red); zero reads as plain ink. */
export const surplusTone = (cents: number) => (cents > 0 ? 'in' : cents < 0 ? 'over' : 'ink');

/** Evenly spaced picks so a long run of dates never crowds the axis: first, last, and between. */
export function axisPicks(count: number, max = 4): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.round((i * (count - 1)) / (max - 1)));
}
