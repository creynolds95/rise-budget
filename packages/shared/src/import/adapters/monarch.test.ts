import { describe, expect, it } from 'vitest';
import { parseCsv, parseMonarchCsv, MONARCH_COLUMNS } from './monarch';

const HEADER = MONARCH_COLUMNS.join(',');
const line = (o: Partial<Record<(typeof MONARCH_COLUMNS)[number], string>> = {}) =>
  MONARCH_COLUMNS.map((c) => {
    const v = {
      Date: '2026-09-30',
      Merchant: 'Blue Goose',
      Category: 'Restaurants & Bars',
      Account: 'Apple Card',
      'Original Statement': 'BLUE GOOSE 123',
      Notes: '',
      Amount: '-55.79',
      Tags: '',
      Owner: 'Shared',
      Reviewed: 'Reviewed',
      Id: '100',
      ...o,
    }[c];
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');

describe('parseCsv', () => {
  it('splits quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('a,"b,c","d ""e""","f\ng"\n1,2,3,4\n')).toEqual([
      ['a', 'b,c', 'd "e"', 'f\ng'],
      ['1', '2', '3', '4'],
    ]);
  });
  it('handles CRLF, a byte-order mark, a missing final newline and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,\n')).toEqual([['a', 'b', '']]);
  });
  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b')).toThrow(/quote/i);
  });
});

describe('parseMonarchCsv', () => {
  it('flips the sign into Rise convention: expense positive, income negative', () => {
    const { rows, errors } = parseMonarchCsv(
      [HEADER, line(), line({ Amount: '2308.40', Id: '101', Category: 'Paychecks' })].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amountCents)).toEqual([5579, -230840]);
  });

  it('keys each row by Monarch id, never by its contents', () => {
    const { rows } = parseMonarchCsv([HEADER, line(), line({ Id: '101' })].join('\n'));
    expect(rows.map((r) => r.sourceId)).toEqual(['monarch:100', 'monarch:101']);
  });

  it('trims category and account names', () => {
    const { rows } = parseMonarchCsv(
      [HEADER, line({ Category: 'Gym ', Account: ' Savings ' })].join('\n'),
    );
    expect(rows[0]).toMatchObject({ category: 'Gym', account: 'Savings' });
  });

  it('reads reviewed state and tags', () => {
    const { rows } = parseMonarchCsv(
      [
        HEADER,
        line({ Reviewed: 'Needs Review', Id: '1' }),
        line({ Reviewed: '', Id: '2', Tags: 'Subscription, Trip' }),
        line({ Id: '3' }),
      ].join('\n'),
    );
    expect(rows.map((r) => r.reviewed)).toEqual(['needs_review', 'unreviewed', 'reviewed']);
    expect(rows[1]?.tags).toEqual(['Subscription', 'Trip']);
    expect(rows[0]?.tags).toEqual([]);
  });

  it('falls back from merchant to original statement and to Unknown', () => {
    const { rows } = parseMonarchCsv(
      [
        HEADER,
        line({ Merchant: '', Id: '1' }),
        line({ Merchant: '', 'Original Statement': '', Id: '2' }),
      ].join('\n'),
    );
    expect(rows.map((r) => r.merchant)).toEqual(['BLUE GOOSE 123', 'Unknown']);
  });

  it('keeps notes and the original statement', () => {
    const { rows } = parseMonarchCsv([HEADER, line({ Notes: 'for Sam' })].join('\n'));
    expect(rows[0]).toMatchObject({ notes: 'for Sam', originalStatement: 'BLUE GOOSE 123' });
  });

  it('reports bad rows by line number and keeps the good ones', () => {
    const { rows, errors } = parseMonarchCsv(
      [
        HEADER,
        line({ Id: '1' }),
        line({ Date: '09/30/2026', Id: '2' }),
        line({ Amount: '12.345', Id: '3' }),
        line({ Id: '' }),
        line({ Id: '1' }),
        'only,three,cells',
      ].join('\n'),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0]?.message).toMatch(/date/i);
    expect(errors[1]?.message).toMatch(/amount/i);
    expect(errors[2]?.message).toMatch(/id/i);
    expect(errors[3]?.message).toMatch(/duplicate/i);
    expect(errors[4]?.message).toMatch(/columns/i);
  });

  it('rejects a calendar-impossible date', () => {
    const { errors } = parseMonarchCsv([HEADER, line({ Date: '2026-02-30' })].join('\n'));
    expect(errors[0]?.message).toMatch(/date/i);
  });

  it('refuses a file without the Monarch columns', () => {
    expect(() => parseMonarchCsv('Date,Amount\n2026-01-01,1.00\n')).toThrow(/column/i);
    expect(() => parseMonarchCsv('')).toThrow(/column/i);
  });

  it('accepts columns in any order', () => {
    const cols = [...MONARCH_COLUMNS].reverse();
    const vals: Record<string, string> = {
      Date: '2026-01-02',
      Merchant: 'M',
      Category: 'C',
      Account: 'A',
      'Original Statement': 'O',
      Notes: '',
      Amount: '1.00',
      Tags: '',
      Owner: 'Shared',
      Reviewed: 'Reviewed',
      Id: '9',
    };
    const text = [cols.join(','), cols.map((c) => vals[c]).join(',')].join('\n');
    expect(parseMonarchCsv(text).rows[0]).toMatchObject({
      postedAt: '2026-01-02',
      amountCents: -100,
    });
  });
});
