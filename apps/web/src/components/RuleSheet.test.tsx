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
});
