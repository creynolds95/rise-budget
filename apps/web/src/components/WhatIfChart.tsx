import { series } from '../design/tokens';
import { compareSeries } from '../lib/whatif';
import { Legend } from './Donut';
import { Chart } from './primitives/Chart';

/** Current plan against a what-if, balance over time. Redraws as the inputs change. */
export function WhatIfChart({
  label,
  period,
  current,
  scenario,
  scenarioName = 'What if',
}: {
  label: string;
  period: string;
  current: number[];
  scenario: number[];
  scenarioName?: string;
}) {
  if (current.length < 3 && scenario.length < 3) return null;
  const s = compareSeries(current, scenario, period);
  return (
    <div className="py-3">
      <Chart
        kind="lines"
        label={label}
        slots={s.slots}
        scrubLabels={s.labels}
        xLabels={s.xLabels}
        lines={[
          { label: 'Current plan', values: s.current, color: series[3] },
          { label: scenarioName, values: s.scenario, color: series[1] },
        ]}
      />
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-caption text-ink-muted">
        <Legend color={series[3]} label="Current plan" />
        <Legend color={series[1]} label={scenarioName} />
      </ul>
    </div>
  );
}
