import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  apiQuery,
  chips,
  dateBounds,
  dayLabel,
  filtersToParams,
  groupByDay,
  isFiltered,
  parseFilters,
  type Filters,
} from './txnFilters';

const names = { account: (id: string) => `acct:${id}`, category: (id: string) => `cat:${id}` };

describe('transaction filters', () => {
  it('round-trips through the URL, dropping defaults', () => {
    const f: Filters = {
      ...EMPTY,
      range: 'last-month',
      accounts: ['a', 'b'],
      categories: ['c'],
      direction: 'out',
      minCents: 5000,
      sort: 'amount_desc',
      review: 'needs_review',
    };
    const p = filtersToParams(f);
    expect(p.toString()).toBe(
      'range=last-month&account=a%2Cb&category=c&direction=out&min=5000&sort=amount_desc&reviewState=needs_review',
    );
    expect(parseFilters(p)).toEqual(f);
    expect(filtersToParams(EMPTY).toString()).toBe('');
  });

  it('carries exclusions in the URL and the API query, and labels them', () => {
    const f: Filters = {
      ...EMPTY,
      categories: ['c', 'd'],
      notCategories: true,
      accounts: ['a'],
      notAccounts: true,
    };
    const p = filtersToParams(f);
    expect(p.toString()).toBe('notAccount=a&notCategory=c%2Cd');
    expect(parseFilters(p)).toEqual(f);
    expect(apiQuery(f, '2026-09-24')).toEqual({ notAccount: 'a', notCategory: 'c,d' });
    const cs = chips(f, names);
    expect(cs.map((c) => c.label)).toEqual(['Not acct:a', 'Not cat:c +1']);
    expect(cs[1]?.clear(f)).toMatchObject({ categories: [], notCategories: false });
    expect(cs[0]?.clear(f)).toMatchObject({ accounts: [], notAccounts: false });
  });

  it('carries tags to the URL, the API and a chip', () => {
    const f: Filters = { ...EMPTY, tags: ['t1', 't2'] };
    const p = filtersToParams(f);
    expect(p.toString()).toBe('tag=t1%2Ct2');
    expect(parseFilters(p)).toEqual(f);
    expect(apiQuery(f, '2026-09-24')).toEqual({ tag: 't1,t2' });
    const [chip] = chips(f, { ...names, tag: (id) => `tag:${id}` });
    expect(chip?.label).toBe('tag:t1 +1');
    expect(chip?.clear(f).tags).toEqual([]);
    expect(chips(f, names)[0]?.label).toBe('Tag +1');
  });

  it('counts as filtered for any narrowing, but not for a sort alone', () => {
    expect(isFiltered(EMPTY)).toBe(false);
    expect(isFiltered({ ...EMPTY, sort: 'amount_desc' })).toBe(false);
    expect(isFiltered({ ...EMPTY, q: 'target' })).toBe(true);
    expect(isFiltered({ ...EMPTY, range: 'ytd' })).toBe(true);
  });

  it('treats old links with from/to as a custom range, and ignores junk', () => {
    const f = parseFilters(new URLSearchParams('from=2026-09-01&sort=sideways&min=abc'));
    expect(f).toMatchObject({
      range: 'custom',
      from: '2026-09-01',
      sort: 'date_desc',
      minCents: null,
    });
  });

  it('turns presets into dates', () => {
    const today = '2026-09-24';
    expect(dateBounds({ ...EMPTY, range: 'this-month' }, today)).toEqual({
      from: '2026-09-01',
      to: '2026-09-24',
    });
    expect(dateBounds({ ...EMPTY, range: 'last-month' }, today)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(dateBounds({ ...EMPTY, range: '3m' }, '2026-02-10')).toEqual({
      from: '2025-12-01',
      to: '2026-02-10',
    });
    expect(dateBounds({ ...EMPTY, range: 'ytd' }, today).from).toBe('2026-01-01');
    expect(dateBounds({ ...EMPTY, range: 'custom', to: '2026-03-01' }, today)).toEqual({
      to: '2026-03-01',
    });
    expect(dateBounds(EMPTY, today)).toEqual({});
  });

  it('builds the API query', () => {
    expect(
      apiQuery({ ...EMPTY, q: ' aldi ', range: 'this-month', maxCents: 100 }, '2026-09-24'),
    ).toEqual({ from: '2026-09-01', to: '2026-09-24', q: 'aldi', max: '100' });
  });

  it('labels one chip per active filter, each clearing only itself', () => {
    const f: Filters = {
      ...EMPTY,
      range: 'custom',
      from: '2026-09-01',
      to: '2026-09-15',
      accounts: ['x', 'y', 'z'],
      minCents: 5000,
      maxCents: 12550,
    };
    const c = chips(f, names);
    expect(c.map((x) => x.label)).toEqual(['Sep 1 – Sep 15', 'acct:x +2', '$50 – $125.50']);
    expect(c[1]?.clear(f)).toEqual({ ...f, accounts: [] });
    expect(chips({ ...EMPTY, maxCents: 2000 }, names)[0]?.label).toBe('Under $20');
    expect(chips({ ...EMPTY, range: 'custom' }, names)).toEqual([]);
  });

  it('labels days the way people say them', () => {
    expect(dayLabel('2026-09-24', '2026-09-24')).toBe('Today');
    expect(dayLabel('2026-09-23', '2026-09-24')).toBe('Yesterday');
    expect(dayLabel('2026-09-18', '2026-09-24')).toBe('Fri, Sep 18');
    expect(dayLabel('2025-12-31', '2026-09-24')).toBe('Wed, Dec 31, 2025');
  });

  it('groups consecutive rows by day', () => {
    const g = groupByDay([
      { postedAt: '2026-09-24', id: 1 },
      { postedAt: '2026-09-24', id: 2 },
      { postedAt: '2026-09-20', id: 3 },
    ]);
    expect(g.map(([d, rows]) => [d, rows.length])).toEqual([
      ['2026-09-24', 2],
      ['2026-09-20', 1],
    ]);
  });
});
