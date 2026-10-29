import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chart } from './Chart';

afterEach(cleanup);

const lines = [
  { label: 'Balance', values: [1_000_000, 600_000, 0], color: '#111' },
  { label: 'Interest to date', values: [0, 200_000, 350_000], color: '#222' },
];

describe('line chart with several series', () => {
  it('touching reads every line at that point, labelled with its date', () => {
    const { container } = render(
      <Chart
        kind="lines"
        label="Schedule"
        slots={3}
        xLabels={['a', 'b', 'c']}
        scrubLabels={['Oct 2026', 'Oct 2036', 'Oct 2046']}
        lines={lines}
      />,
    );
    const area = container.querySelector('div.relative') as HTMLElement;
    // jsdom has no layout, so a touch far right lands on the last point.
    fireEvent.pointerDown(area, { clientX: 500, pointerType: 'mouse' });
    expect(screen.getByText('Oct 2046')).toBeTruthy();
    expect(screen.getByText('Balance · $0')).toBeTruthy();
    expect(screen.getByText('Interest to date · $3,500')).toBeTruthy();
    fireEvent.pointerUp(area);
    expect(screen.queryByText('Oct 2046')).toBeNull();
  });

  it('without scrub labels it stays a plain chart', () => {
    const { container } = render(
      <Chart kind="lines" label="Plain" slots={3} xLabels={['a', 'b', 'c']} lines={lines} />,
    );
    const area = container.querySelector('div.relative') as HTMLElement;
    fireEvent.pointerDown(area, { clientX: 500, pointerType: 'mouse' });
    expect(screen.queryByText('Balance · $0')).toBeNull();
  });
});

describe('detailed line chart', () => {
  it('shows dollar values at the side, shades the live line and labels its end', () => {
    const { container } = render(
      <Chart
        kind="lines"
        label="Spend"
        slots={3}
        xLabels={['1', '2', '3']}
        detailed
        lines={[
          { label: 'Last', values: [100_000, 500_000, 1_000_000], color: '#111' },
          { label: 'Now', values: [100_000, 525_834, 525_834], color: '#222', live: true },
        ]}
      />,
    );
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getByText('$5K')).toBeTruthy();
    expect(screen.getByText('$5,258')).toBeTruthy();
    expect(container.querySelector('polygon[data-area]')).toBeTruthy();
  });

  it('the default chart has none of it', () => {
    const { container } = render(
      <Chart kind="lines" label="Plain" slots={3} xLabels={['a', 'b', 'c']} lines={lines} />,
    );
    expect(container.querySelector('polygon')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();
  });
});
