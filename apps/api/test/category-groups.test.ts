import { describe, expect, it } from 'vitest';
import { call, signedInUser } from './helpers/http';

async function setup() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  return { ...u, api };
}

describe('L6 category groups: rename, reorder, delete', () => {
  it('renames and reorders a group', async () => {
    const s = await setup();
    const group = (await s.api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
      .json;
    const renamed = await s.api('PATCH', `/category-groups/${group.id}`, {
      name: 'Day to Day',
      sortOrder: 3,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({ id: group.id, name: 'Day to Day', sortOrder: 3 });
    // Its kind never changes — not offered as a patchable field.
    expect(renamed.json.kind).toBe('expense');
  });

  it('404s renaming a group that does not exist or belongs to someone else', async () => {
    const a = await setup();
    const b = await setup();
    const group = (await a.api('POST', '/category-groups', { name: 'Mine', kind: 'expense' })).json;
    expect(
      (await b.api('PATCH', `/category-groups/${group.id}`, { name: 'Not yours' })).status,
    ).toBe(404);
    expect(
      (await a.api('PATCH', `/category-groups/${crypto.randomUUID()}`, { name: 'x' })).status,
    ).toBe(404);
  });

  it('refuses to delete a group that has ever held a category, even archived (archive, never orphan)', async () => {
    const s = await setup();
    const group = (await s.api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
      .json;
    const cat = (await s.api('POST', '/categories', { groupId: group.id, name: 'Groceries' })).json;

    const blocked = await s.api('DELETE', `/category-groups/${group.id}`);
    expect(blocked.status).toBe(409);

    // Archiving the category doesn't free the group either — the row (and its group_id) lives
    // on for history, same as a category never truly disappears (SPEC §2.10).
    await s.api('DELETE', `/categories/${cat.id}`);
    expect((await s.api('DELETE', `/category-groups/${group.id}`)).status).toBe(409);
  });

  it('deletes a group that never held a category', async () => {
    const s = await setup();
    const group = (await s.api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
      .json;
    const ok = await s.api('DELETE', `/category-groups/${group.id}`);
    expect(ok.status).toBe(200);
    expect((await s.api('GET', '/category-groups')).json).toEqual([]);
  });

  it('reorders a category within and across groups', async () => {
    const s = await setup();
    const group = (await s.api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
      .json;
    const other = (await s.api('POST', '/category-groups', { name: 'Other', kind: 'expense' }))
      .json;
    const a = (await s.api('POST', '/categories', { groupId: group.id, name: 'A' })).json;
    const b = (await s.api('POST', '/categories', { groupId: group.id, name: 'B' })).json;

    const swapped = await s.api('PATCH', `/categories/${a.id}`, { sortOrder: 5 });
    expect(swapped.json.sortOrder).toBe(5);

    const moved = await s.api('PATCH', `/categories/${b.id}`, {
      groupId: other.id,
      sortOrder: 0,
    });
    expect(moved.json).toMatchObject({ groupId: other.id, sortOrder: 0 });
  });
});
