import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { DetailPage, ZONES } from './DetailPage';

afterEach(cleanup);

const zonesIn = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-zone]')].map((z) => z.getAttribute('data-zone'));

describe('DetailPage (DESIGN-SYSTEM.md §5)', () => {
  it('renders zones in the fixed order whatever order the props are given in', () => {
    const { container } = render(
      <MemoryRouter>
        <DetailPage
          manage={<p>forgive</p>}
          related={{ title: 'Transactions', children: <p>t</p> }}
          facts={<p>facts</p>}
          shape={<p>chart</p>}
          identity={{ label: 'Available this month', hero: '−$93' }}
          header={{ back: { label: 'Budget', to: '/budget' }, title: 'Gas' }}
        />
      </MemoryRouter>,
    );
    expect(zonesIn(container)).toEqual([...ZONES]);
  });

  it('zones can be omitted', () => {
    const { container } = render(
      <MemoryRouter>
        <DetailPage
          header={{ back: { label: 'Budget', to: '/budget' }, title: 'Gas' }}
          facts={<p>f</p>}
        />
      </MemoryRouter>,
    );
    expect(zonesIn(container)).toEqual(['header', 'facts']);
  });

  it('the back control names its origin; a bare arrow is refused', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <DetailPage
          header={{ back: { label: 'USAA Checking', to: '/accounts/1' }, title: 'Kroger' }}
        />
      </MemoryRouter>,
    );
    expect(getByRole('link').textContent).toBe('‹USAA Checking');
    expect(() =>
      render(
        <MemoryRouter>
          <DetailPage header={{ back: { label: ' ', to: '/' }, title: 'x' }} />
        </MemoryRouter>,
      ),
    ).toThrow(/origin/);
  });
});
