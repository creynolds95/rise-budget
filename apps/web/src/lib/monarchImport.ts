import type {
  AccountChoice,
  AccountPlan,
  CategoryChoice,
  CategoryKind,
  CategoryPlan,
  DuplicateGroup,
  GuessedAccountKind,
  ImportRow,
} from '@rise/shared/import';
import type { MonarchSetupBody } from '@rise/shared/schemas';

export const CHUNK = 100;

export function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What to create before any row is written: only the accounts and categories set to "new". */
export function setupBody(
  accounts: AccountPlan[],
  categories: CategoryPlan[],
  accountChoices: Record<string, AccountChoice>,
  categoryChoices: Record<string, CategoryChoice>,
  categoryGroups: Record<string, string> = {},
): MonarchSetupBody {
  const a: MonarchSetupBody['accounts'] = [];
  for (const p of accounts) {
    const c = accountChoices[p.monarchName] ?? p.choice;
    if (c.type === 'create') a.push({ monarchName: p.monarchName, kind: c.kind });
  }
  const k: MonarchSetupBody['categories'] = [];
  for (const p of categories) {
    const c = categoryChoices[p.monarchName] ?? p.choice;
    if (c.type !== 'create') continue;
    const groupId = categoryGroups[p.monarchName];
    k.push(
      groupId && c.kind !== 'transfer'
        ? { monarchName: p.monarchName, kind: c.kind, groupId }
        : { monarchName: p.monarchName, kind: c.kind },
    );
  }
  return { accounts: a, categories: k };
}

/** Name → Rise id, from the existing choices plus what setup just created. */
export function resolveIds(
  plans: { monarchName: string; choice: AccountChoice | CategoryChoice }[],
  choices: Record<string, AccountChoice | CategoryChoice>,
  created: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of plans) {
    const c = choices[p.monarchName] ?? p.choice;
    if (c.type === 'existing')
      out.set(p.monarchName, 'accountId' in c ? c.accountId : c.categoryId);
    else {
      const id = created[p.monarchName];
      if (id) out.set(p.monarchName, id);
    }
  }
  return out;
}

export const duplicateKey = (g: DuplicateGroup) => g.sourceIds.join(',');

/** Rows the person chose to skip: every extra in a ticked group; the first is always kept. */
export function skippedIds(groups: DuplicateGroup[], skipped: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const g of groups)
    if (skipped.has(duplicateKey(g))) for (const id of g.sourceIds.slice(1)) out.add(id);
  return out;
}

export function withoutSkipped(rows: ImportRow[], skip: ReadonlySet<string>): ImportRow[] {
  return rows.filter((r) => !skip.has(r.sourceId));
}

export const ACCOUNT_KINDS: Record<GuessedAccountKind, string> = {
  depository: 'Checking or savings',
  credit: 'Credit card',
  loan: 'Loan',
};
export const CATEGORY_KINDS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer (not spending)',
};

/** New income or expense categories still waiting for a group. Transfers get theirs automatically. */
export function needGroup(
  categories: CategoryPlan[],
  choices: Record<string, CategoryChoice>,
  groups: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const p of categories) {
    const c = choices[p.monarchName] ?? p.choice;
    if (c.type === 'create' && c.kind !== 'transfer' && !groups[p.monarchName])
      out.push(p.monarchName);
  }
  return out;
}
