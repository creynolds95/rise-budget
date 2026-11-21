import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryPicker } from './CategoryPicker';

vi.mock('../lib/queries', () => ({
  useGroups: () => ({ data: [{ id: 'g1', name: 'Everyday' }] }),
  useCategories: () => ({
    data: [
      { id: 'a', name: 'Groceries', groupId: 'g1' },
      { id: 'b', name: 'Household', groupId: 'g1' },
      { id: 'c', name: 'Gas', groupId: 'g1' },
      { id: 'd', name: 'Fun', groupId: 'g1' },
      { id: 'e', name: 'Clothing', groupId: 'g1' },
    ],
  }),
}));
vi.mock('./primitives/Sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

const render_ = (suggested?: string[], onPick = vi.fn()) =>
  render(<CategoryPicker open suggested={suggested} onPick={onPick} onClose={() => {}} />);

describe('CategoryPicker suggestions', () => {
  it('shows a merchant’s top three first, skipping stale ids', () => {
    render_(['b', 'gone', 'a', 'c', 'd']);
    const section = screen.getByLabelText('Suggested');
    expect([...section.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Household',
      'Groceries',
    ]);
  });

  it('has no Suggested section without suggestions', () => {
    render_(undefined);
    expect(screen.queryByLabelText('Suggested')).toBeNull();
    render_([]);
    expect(screen.queryByLabelText('Suggested')).toBeNull();
  });

  it('picks from the suggestion with the always toggle state', () => {
    const onPick = vi.fn();
    render(
      <CategoryPicker
        open
        always={{ merchant: 'Costco' }}
        suggested={['c']}
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    fireEvent.click(within(screen.getByLabelText('Suggested')).getByText('Gas'));
    expect(onPick).toHaveBeenCalledWith('c', false);
  });
});
