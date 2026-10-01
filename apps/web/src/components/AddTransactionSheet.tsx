import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { longDate } from '../lib/dates';
import { useAccounts, useCategories, useInvalidateMoney, useToday } from '../lib/queries';
import { CategoryPicker } from './CategoryPicker';
import { MoneyField } from './primitives/MoneyField';
import { ValueRow } from './primitives/Rows';
import { Sheet } from './primitives/Sheet';

/** A transaction typed in by hand: cash, a check, anything the bank feed won't carry. */
export function AddTransactionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archivedAt);
  const categories = useCategories().data ?? [];
  const today = useToday();
  const invalidate = useInvalidateMoney();
  const [descriptor, setDescriptor] = useState('');
  const [cents, setCents] = useState(0);
  const [income, setIncome] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [postedAt, setPostedAt] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accountId || accounts[0]?.id || '';
  const date = postedAt || today;
  const category = categories.find((c) => c.id === categoryId);
  const valid = descriptor.trim() !== '' && cents > 0 && account !== '';

  const reset = () => {
    setDescriptor('');
    setCents(0);
    setIncome(false);
    setAccountId('');
    setPostedAt('');
    setCategoryId(null);
    setNotes('');
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/transactions', {
        accountId: account,
        postedAt: date,
        // Spending is positive, money in is negative (SPEC §1.1).
        amountCents: income ? -cents : cents,
        descriptor: descriptor.trim(),
        ...(categoryId ? { categoryId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      await invalidate();
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        title="New transaction"
        onClose={close}
        action={{ label: 'Add', onClick: () => void save(), disabled: !valid || busy }}
        fullScreen
      >
        <div role="radiogroup" aria-label="Kind" className="flex gap-1 rounded-card bg-surface p-1">
          {[
            { on: false, label: 'Expense' },
            { on: true, label: 'Income' },
          ].map((o) => (
            <button
              key={o.label}
              role="radio"
              aria-checked={income === o.on}
              onClick={() => setIncome(o.on)}
              className={`min-h-10 flex-1 rounded-input font-medium ${
                income === o.on ? 'bg-sage-600 text-surface' : 'text-ink-muted'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-2 rounded-card bg-surface px-4 shadow-soft">
          <div className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3">
            <span className="text-ink-muted">Amount</span>
            <MoneyField label="Amount" cents={cents} onCommit={setCents} />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3">
            <span className="shrink-0 text-ink-muted">Merchant</span>
            <input
              aria-label="Merchant"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-right placeholder:text-ink-faint focus:outline-none"
              value={descriptor}
              placeholder="Where"
              onChange={(e) => setDescriptor(e.target.value)}
            />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-3">
            <span className="shrink-0 text-ink-muted">Account</span>
            <select
              aria-label="Account"
              className="min-h-11 min-w-0 bg-transparent text-right focus:outline-none"
              value={account}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <ValueRow label="Category" onClick={() => setPicking(true)}>
            {category ? `${category.emoji ? `${category.emoji} ` : ''}${category.name}` : 'Choose…'}
          </ValueRow>
          <label className="relative block">
            <ValueRow label="Date" onClick={() => {}}>
              {longDate(date)}
            </ValueRow>
            <input
              type="date"
              aria-label="Date"
              value={date}
              onChange={(e) => e.target.value && setPostedAt(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
          <div className="flex min-h-12 items-center justify-between gap-4 py-3">
            <span className="shrink-0 text-ink-muted">Notes</span>
            <input
              aria-label="Notes"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-right placeholder:text-ink-faint focus:outline-none"
              value={notes}
              placeholder="Add notes…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-clay">{error}</p>}
      </Sheet>
      <CategoryPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCategoryId(c);
          setPicking(false);
        }}
      />
    </>
  );
}
