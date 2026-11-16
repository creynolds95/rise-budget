import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleSheet } from './RuleSheet';

const api = vi.fn((..._args: unknown[]) => Promise.resolve({}));
vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  api: (...args: unknown[]) => api(...args),
}));
vi.mock('./CategoryPicker', () => ({ CategoryPicker: () => null }));
vi.mock('../lib/queries', () => ({
  useCategories: () => ({ data: [{ id: 'c1', name: 'Gas' }] }),
}));

afterEach(() => {
  cleanup();
  api.mockClear();
});

describe('RuleSheet from a transaction', () => {
  it('opens prefilled and saves only on Save', async () => {
    const onSaved = vi.fn(() => Promise.resolve());
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RuleSheet
          rule={null}
          initial={{
            matchField: 'merchant',
            matchType: 'equals',
            matchValue: 'QUIKTRIP',
            categoryId: 'c1',
          }}
          onClose={() => {}}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Match value')).toHaveProperty('value', 'QUIKTRIP');
    expect(screen.getByText('Gas')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Save rule'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('POST', '/rules', {
      matchField: 'merchant',
      matchType: 'equals',
      matchValue: 'QUIKTRIP',
      categoryId: 'c1',
      priority: 0,
    });
  });

  it('offers to file waiting transactions and only does so on a tap', async () => {
    api.mockImplementation((...a: unknown[]) => {
      if (a[1] === '/rules') return Promise.resolve({ id: 'r1' });
      if (a[1] === '/rules/r1/waiting') return Promise.resolve({ ids: ['t1', 't2'], count: 2 });
      return Promise.resolve({});
    });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RuleSheet
          rule={null}
          initial={{
            matchField: 'merchant',
            matchType: 'equals',
            matchValue: 'QUIKTRIP',
            categoryId: 'c1',
          }}
          onClose={onClose}
          onSaved={() => Promise.resolve()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Save rule'));
    await screen.findByText('File earlier ones too?');
    expect(onClose).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalledWith('POST', '/transactions/bulk-accept', expect.anything());
    fireEvent.click(screen.getByText('Yes, file all 2'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('POST', '/transactions/bulk-accept', { ids: ['t1', 't2'] });
  });
});
