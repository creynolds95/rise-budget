import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAN } from '../lib/retirement';
import { Retirement } from './Retirement';

const patch = vi.fn();
vi.mock('../lib/api', () => ({ api: (...a: unknown[]) => patch(...a) }));
vi.mock('../lib/queries', () => ({
  useMe: () => ({
    data: { settings: { retirement: { ...DEFAULT_PLAN, currentAge: 31 } } },
    status: 'success',
    isStale: false,
    isFetching: false,
  }),
  useAccounts: () => ({ data: [] }),
}));

vi.mock('../components/OfflineBar', () => ({ useOnline: () => true }));

afterEach(cleanup);

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Retirement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText('Retirement settings'));
}

describe('Retirement settings', () => {
  it('takes typed numbers and saves every edit with Save, with no blur needed', async () => {
    open();
    const age = screen.getByLabelText('Your age') as HTMLInputElement;
    fireEvent.change(age, { target: { value: '44' } });
    expect(age.value).toBe('44');
    const claim = screen.getByLabelText('Your claiming age') as HTMLInputElement;
    fireEvent.change(claim, { target: { value: '6' } });
    expect(claim.value).toBe('6');
    fireEvent.change(claim, { target: { value: '68' } });
    const goal = screen.getByLabelText('Monthly spending goal');
    fireEvent.change(goal, { target: { value: '6000' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('PATCH', '/me/settings', {
        retirement: expect.objectContaining({
          currentAge: 44,
          ssClaimAge: 68,
          spendTargetCents: 600_000,
        }),
      }),
    );
  });

  it('keeps a half-typed decimal and clamps the claiming age only on save', async () => {
    open();
    const growth = screen.getByLabelText('Growth after inflation') as HTMLInputElement;
    fireEvent.change(growth, { target: { value: '4.' } });
    expect(growth.value).toBe('4.');
    fireEvent.change(screen.getByLabelText('Your claiming age'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('PATCH', '/me/settings', {
        retirement: expect.objectContaining({ ssClaimAge: 70, realGrowthBps: 400 }),
      }),
    );
  });

  it('groups fields by who they are about', () => {
    open();
    for (const h of ['You', 'Spouse', 'Plan, both of you', 'Contributions by account'])
      expect(screen.getByText(h)).toBeTruthy();
  });
});
