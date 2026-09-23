import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createAccount, createUser, getAccount, listAccounts } from '../src/db';

// T13 AC 1: scan the query layer; every SQL statement must filter on user_id.
const sources = import.meta.glob('../src/db/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SQL = /(['`])\s*((?:SELECT|INSERT|UPDATE|DELETE|WITH)\b[\s\S]*?)\1/gi;

describe('query layer scoping', () => {
  it('finds the query modules', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(1);
  });

  for (const [file, src] of Object.entries(sources)) {
    it(`every statement in ${file.split('/').pop()} filters on user_id`, () => {
      const statements = [...src.matchAll(SQL)].map((m) => m[2] as string);
      for (const sql of statements) {
        expect(/\buser_id\b/.test(sql) || sql.includes('/* scoped:user.id */'), sql).toBe(true);
      }
    });
  }

  it('the scanner itself catches an unscoped statement', () => {
    const bad = "db.prepare('SELECT * FROM account WHERE id = ?1')";
    const statements = [...bad.matchAll(SQL)].map((m) => m[2] as string);
    expect(statements).toHaveLength(1);
    expect(/\buser_id\b/.test(statements[0] as string)).toBe(false);
  });
});

// T13 AC 2: cross-user reads return empty.
describe('cross-user isolation', () => {
  it("one user cannot read another user's accounts", async () => {
    await createUser('alice', env.DB, { email: 'alice@example.com', displayName: 'Alice' });
    await createUser('bob', env.DB, { email: 'bob@example.com', displayName: 'Bob' });
    const acct = await createAccount('alice', env.DB, {
      name: 'USAA Checking',
      kind: 'depository',
      source: 'manual',
    });

    expect(await listAccounts('alice', env.DB)).toHaveLength(1);
    expect(await listAccounts('bob', env.DB)).toEqual([]);
    expect(await getAccount('bob', env.DB, acct.id)).toBeNull();
  });
});
