import { describe, expect, it } from 'vitest';
import { ClientPerfBody, bodyKeys, clientRoute, diffFields } from './index';

const rule = { keep: ['amount_cents', 'splits'], text: ['notes'] };

describe('activity diff', () => {
  it('keeps structured fields with before and after', () => {
    expect(
      diffFields(
        { amount_cents: 100, splits: 'a:100' },
        { amount_cents: 100, splits: 'b:100' },
        rule,
      ),
    ).toEqual([{ field: 'splits', before: 'a:100', after: 'b:100' }]);
  });
  it('records free text only as changed, with its length', () => {
    const d = diffFields({ notes: 'old secret' }, { notes: 'new secret!' }, rule);
    expect(d).toEqual([{ field: 'notes', changed: true, length: 11 }]);
    expect(JSON.stringify(d)).not.toContain('secret');
  });
  it('treats a created or deleted row as everything changing', () => {
    expect(diffFields(null, { amount_cents: 5 }, rule)).toEqual([
      { field: 'amount_cents', before: null, after: 5 },
    ]);
    expect(diffFields({ amount_cents: 5 }, null, rule)).toEqual([
      { field: 'amount_cents', before: 5, after: null },
    ]);
  });
  it('reports nothing when nothing changed', () => {
    expect(diffFields({ amount_cents: 1 }, { amount_cents: 1 }, rule)).toEqual([]);
  });
});

describe('activity helpers', () => {
  it('lists body field names, never values', () => {
    expect(bodyKeys({ b: 'x', a: 1 })).toEqual(['a', 'b']);
    expect(bodyKeys([1])).toEqual([]);
    expect(bodyKeys(null)).toEqual([]);
  });
  it('collapses ids and dates in client routes', () => {
    expect(clientRoute('/periods/2026-09?x=1')).toBe('/periods/:id');
    expect(clientRoute('/transactions/3f2b9c1e-aaaa-bbbb-cccc-1234567890ab/splits')).toBe(
      '/transactions/:id/splits',
    );
  });
  it('bounds a client report', () => {
    expect(ClientPerfBody.safeParse({ samples: [] }).success).toBe(true);
    expect(
      ClientPerfBody.safeParse({ samples: [{ route: 'x', n: 0, errors: 0, msTotal: 0, msMax: 0 }] })
        .success,
    ).toBe(false);
  });
});
