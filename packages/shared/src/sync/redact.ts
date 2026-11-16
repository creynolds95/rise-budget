/**
 * Masking for anything the diagnostics log hands out. Pure. Accounts become stable codes
 * (`acct-1`, `Bank A`) in the order they were added, so a pasted snapshot stays readable
 * across runs without carrying a name, a nickname, an institution or an account number.
 */

export interface AccountIdentity {
  id: string;
  kind: string;
  name: string;
  nickname?: string | null;
  institutionName?: string | null;
  sourceAccountId?: string | null;
  createdAt: string;
}

export interface MaskedAccount {
  code: string;
  bank: string;
  kind: string;
  label: string;
}

const letter = (n: number): string => {
  let s = '';
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
};

export function maskAccounts(accounts: readonly AccountIdentity[]): Map<string, MaskedAccount> {
  const ordered = [...accounts].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const banks = new Map<string, string>();
  const out = new Map<string, MaskedAccount>();
  ordered.forEach((a, ix) => {
    const key = (a.institutionName ?? '').trim().toLowerCase() || `?${a.id}`;
    if (!banks.has(key)) banks.set(key, `Bank ${letter(banks.size)}`);
    const bank = banks.get(key) as string;
    const code = `acct-${ix + 1}`;
    out.set(a.id, { code, bank, kind: a.kind, label: `${bank} · ${a.kind} · ${code}` });
  });
  return out;
}

/** Names that must never appear in text that leaves the instance (errors quote them). */
export function sensitiveNames(accounts: readonly AccountIdentity[]): string[] {
  const names = accounts.flatMap((a) => [a.name, a.nickname, a.institutionName, a.sourceAccountId]);
  return [
    ...new Set(names.filter((n): n is string => typeof n === 'string' && n.trim().length >= 3)),
  ]
    .map((n) => n.trim())
    .sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace known names, then any run of 5+ digits (account numbers), then trim to a safe length. */
export function redactText(text: string, names: readonly string[], max = 300): string {
  let out = text;
  for (const n of names) out = out.replace(new RegExp(escapeRe(n), 'gi'), '[name]');
  return out.replace(/\d{5,}/g, '#').slice(0, max);
}
