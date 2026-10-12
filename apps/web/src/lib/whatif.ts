import { addMonths, monthName } from './dates';

/**
 * Two balance-by-month runs on one shared axis: up to ~60 evenly spaced points, always ending
 * at the later finish. The run that finishes first sits at zero for the rest.
 */
export function compareSeries(current: number[], scenario: number[], period: string) {
  const n = Math.max(current.length, scenario.length);
  const step = Math.max(1, Math.ceil((n - 1) / 60));
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i += step) idx.push(i);
  idx.push(Math.max(0, n - 1));
  const at = (a: number[], i: number) => a[i] ?? 0;
  const label = (m: number) => monthName(addMonths(period, m)).replace(/^(\w{3})\w* /, '$1 ');
  return {
    slots: idx.length,
    current: idx.map((i) => at(current, i)),
    scenario: idx.map((i) => at(scenario, i)),
    labels: idx.map(label),
    xLabels: [label(0), label(Math.round((n - 1) / 2)), label(n - 1)],
  };
}
