import type { Account, Binder, BinderEntry } from '@rise/shared/schemas';

export const BINDER_KINDS: { kind: BinderEntry['kind']; title: string }[] = [
  { kind: 'account', title: 'Accounts' },
  { kind: 'insurance', title: 'Insurance' },
  { kind: 'person', title: 'People to call' },
  { kind: 'document', title: 'Documents' },
  { kind: 'other', title: 'Other' },
];

export interface BinderRow {
  /** The saved entry, or null for an account with nothing written down yet. */
  entry: BinderEntry | null;
  title: string;
  accountId: string | null;
  /** One line under the title: what's filled in, in a fixed order. */
  detail: string;
}

/** A blank entry of a kind; an account's starts from the account. */
export function blankEntry(
  kind: BinderEntry['kind'],
  account?: Pick<Account, 'id' | 'name'>,
): BinderEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    title: account?.name ?? '',
    accountId: account?.id ?? null,
    last4: null,
    phone: '',
    website: '',
    location: '',
    notes: '',
  };
}

const detailOf = (e: BinderEntry | null, mask: string | null) =>
  [
    e?.last4 ? `••${e.last4}` : mask ? `••${mask}` : null,
    e?.phone || null,
    e?.website || null,
    e?.location || null,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The binder by section. Every open Rise account is listed under Accounts whether or not
 * anything has been written about it yet, so nothing is forgotten (SPEC §12.2).
 */
export function binderSections(
  binder: Binder,
  accounts: readonly Pick<Account, 'id' | 'name' | 'mask' | 'archivedAt'>[],
): { kind: BinderEntry['kind']; title: string; rows: BinderRow[] }[] {
  const open = accounts.filter((a) => !a.archivedAt);
  const linked = new Map(binder.entries.filter((e) => e.accountId).map((e) => [e.accountId, e]));
  return BINDER_KINDS.map(({ kind, title }) => {
    const own = binder.entries
      .filter((e) => e.kind === kind && !(kind === 'account' && e.accountId))
      .map((e) => ({
        entry: e,
        title: e.title,
        accountId: e.accountId,
        detail: detailOf(e, null),
      }));
    const fromAccounts =
      kind === 'account'
        ? open.map((a) => {
            const e = linked.get(a.id) ?? null;
            return {
              entry: e,
              title: e?.title || a.name,
              accountId: a.id,
              detail: detailOf(e, a.mask),
            };
          })
        : [];
    return { kind, title, rows: [...fromAccounts, ...own] };
  });
}
