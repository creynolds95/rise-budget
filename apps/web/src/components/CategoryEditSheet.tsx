import type { Category, CategoryGroup } from '@rise/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { monthName } from '../lib/dates';
import { useInvalidateMoney, useRules } from '../lib/queries';
import { Button } from './primitives/Button';
import { Group, GroupRow } from './primitives/Group';
import { Icon } from './primitives/Icon';
import { Sheet } from './primitives/Sheet';
import { Toggle } from './primitives/Toggle';

const EMOJI: { char: string; keywords: string }[] = [
  { char: '🛒', keywords: 'cart grocery groceries shopping food' },
  { char: '🍔', keywords: 'burger dining eating out fast food' },
  { char: '☕', keywords: 'coffee cafe drink' },
  { char: '🍕', keywords: 'pizza dining food' },
  { char: '🍻', keywords: 'beer bar drinks alcohol' },
  { char: '🥡', keywords: 'takeout delivery food' },
  { char: '⛽', keywords: 'gas fuel gasoline auto car' },
  { char: '🚗', keywords: 'car auto transport payment' },
  { char: '🚌', keywords: 'bus transit public transport' },
  { char: '✈️', keywords: 'flight travel airplane vacation' },
  { char: '🏠', keywords: 'home house rent mortgage housing' },
  { char: '💡', keywords: 'utilities electric power light bulb' },
  { char: '💧', keywords: 'water utilities' },
  { char: '📱', keywords: 'phone cell mobile subscription' },
  { char: '🌐', keywords: 'internet wifi web' },
  { char: '📺', keywords: 'tv streaming cable entertainment' },
  { char: '🎵', keywords: 'music streaming spotify entertainment' },
  { char: '🎮', keywords: 'games gaming entertainment' },
  { char: '🎬', keywords: 'movies entertainment streaming' },
  { char: '📚', keywords: 'books education school' },
  { char: '👕', keywords: 'clothes clothing shopping apparel' },
  { char: '💇', keywords: 'haircut salon personal care' },
  { char: '💊', keywords: 'medicine pharmacy health medical' },
  { char: '🏥', keywords: 'hospital medical health insurance' },
  { char: '🦷', keywords: 'dental dentist health' },
  { char: '🏋️', keywords: 'gym fitness workout health' },
  { char: '🐶', keywords: 'dog pet pets' },
  { char: '👶', keywords: 'baby kids child childcare' },
  { char: '🎁', keywords: 'gift gifts present' },
  { char: '🎉', keywords: 'party celebration entertainment' },
  { char: '🎓', keywords: 'education school student loan tuition' },
  { char: '🧾', keywords: 'receipt bill payment' },
  { char: '💳', keywords: 'credit card payment debt' },
  { char: '🏦', keywords: 'bank transfer savings' },
  { char: '💰', keywords: 'money savings income' },
  { char: '📈', keywords: 'investment income growth paycheck' },
  { char: '🛠️', keywords: 'repair maintenance tools' },
  { char: '🧹', keywords: 'cleaning supplies home' },
  { char: '🌱', keywords: 'garden plants lawn yard' },
  { char: '❤️', keywords: 'health love care' },
  { char: '⛪', keywords: 'church donation giving' },
  { char: '🏖️', keywords: 'vacation travel beach' },
  { char: '🎄', keywords: 'holiday christmas gifts' },
  { char: '🧸', keywords: 'kids toys childcare' },
  { char: '💼', keywords: 'work business income paycheck' },
  { char: '🔌', keywords: 'electric utilities power' },
  { char: '🛡️', keywords: 'insurance protection' },
  { char: '🚿', keywords: 'water utilities shower' },
  { char: '💵', keywords: 'cash income paycheck salary money' },
  { char: '🧑‍💻', keywords: 'salary income paycheck work' },
  { char: '🚙', keywords: 'car auto suv transport' },
  { char: '🅿️', keywords: 'parking' },
  { char: '🛡', keywords: 'insurance' },
  { char: '📦', keywords: 'shipping package delivery amazon' },
  { char: '🧴', keywords: 'personal care toiletries' },
  { char: '👟', keywords: 'shoes clothing shopping' },
  { char: '🍼', keywords: 'baby childcare' },
  { char: '🚕', keywords: 'rideshare uber lyft taxi transport' },
  { char: '🅾️', keywords: 'other misc miscellaneous' },
];

/** Loose match: every search word must appear somewhere in the emoji's keywords. */
function matchesEmojiSearch(entry: { keywords: string }, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => entry.keywords.includes(w));
}

/**
 * Everything about a category in one sheet: what it's called, where it sits, how leftovers
 * behave, and the way out. Saves only what changed.
 */
export function CategoryEditSheet({
  category,
  groups,
  onClose,
  onDeleted,
}: {
  category: Category | null;
  groups: CategoryGroup[];
  onClose: () => void;
  onDeleted?: () => void;
}) {
  if (!category) return null;
  return (
    <Editor
      key={category.id}
      category={category}
      groups={groups}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  );
}

function Editor({
  category,
  groups,
  onClose,
  onDeleted,
}: {
  category: Category;
  groups: CategoryGroup[];
  onClose: () => void;
  onDeleted?: (() => void) | undefined;
}) {
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const rules = useRules().data ?? [];
  const kind = groups.find((g) => g.id === category.groupId)?.kind ?? 'expense';
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState<string | null>(category.emoji);
  const [picking, setPicking] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const filteredEmoji = EMOJI.filter((e) => matchesEmojiSearch(e, emojiSearch));
  const [groupId, setGroupId] = useState(category.groupId);
  const [roll, setRoll] = useState(category.rolloverPolicy === 'roll');
  const [once, setOnce] = useState(category.spendShape === 'fixed');
  const [budgeted, setBudgeted] = useState(category.budgeted);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ruleCount = rules.filter((r) => r.categoryId === category.id).length;

  const patch: Record<string, unknown> = {};
  if (name.trim() && name.trim() !== category.name) patch.name = name.trim();
  if (emoji !== category.emoji) patch.emoji = emoji;
  if (groupId !== category.groupId) patch.groupId = groupId;
  if (kind === 'expense') {
    const policy = roll ? 'roll' : 'return_to_pool';
    if (policy !== category.rolloverPolicy) patch.rolloverPolicy = policy;
    const shape = once ? 'fixed' : 'linear';
    if (shape !== category.spendShape) patch.spendShape = shape;
    if (budgeted !== category.budgeted) patch.budgeted = budgeted;
  }
  const dirty = Object.keys(patch).length > 0;

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['rules'] })]);
      after();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    dirty ? run(() => api('PATCH', `/categories/${category.id}`, patch), onClose) : onClose();

  const field = 'min-w-0 flex-1 bg-transparent text-right outline-none';
  return (
    <Sheet
      open
      title="Edit category"
      onClose={onClose}
      action={{ label: 'Save', onClick: () => void save(), disabled: busy || !name.trim() }}
    >
      <Group>
        <GroupRow label="Name" htmlFor="cat-name">
          <input
            id="cat-name"
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </GroupRow>
        <button
          type="button"
          onClick={() => setPicking(!picking)}
          aria-expanded={picking}
          className="flex min-h-13 w-full items-center justify-between gap-4 px-4 py-3 text-left active:bg-sage-100"
        >
          <span>Emoji</span>
          <span className="flex items-center gap-2 text-ink-muted">
            {emoji ? <span className="text-2xl leading-none">{emoji}</span> : <span>None</span>}
            <span className={`transition-transform ${picking ? 'rotate-180' : ''}`}>
              <Icon name="chevronDown" size={18} />
            </span>
          </span>
        </button>
        {picking && (
          <div className="px-3 pt-1 pb-3">
            <input
              aria-label="Search emoji"
              placeholder="Search (e.g. car, food, gift)"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              className="mb-2 min-h-11 w-full rounded-input border border-hairline bg-canvas px-3"
            />
            {filteredEmoji.length > 0 ? (
              <div role="listbox" aria-label="Emoji" className="grid grid-cols-8 gap-1">
                {filteredEmoji.map((e) => (
                  <button
                    key={e.char}
                    type="button"
                    role="option"
                    aria-selected={e.char === emoji}
                    onClick={() => {
                      setEmoji(e.char);
                      setPicking(false);
                    }}
                    className={`flex aspect-square items-center justify-center rounded-input text-2xl ${
                      e.char === emoji ? 'bg-sage-100 ring-2 ring-sage-600' : 'active:bg-sage-100'
                    }`}
                  >
                    {e.char}
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-2 type-caption text-ink-muted">
                No match — type any emoji below instead.
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <input
                aria-label="Or type any emoji"
                placeholder="Or type any emoji"
                maxLength={8}
                className="min-h-11 min-w-0 flex-1 rounded-input border border-hairline bg-canvas px-3"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v) setEmoji(v);
                }}
              />
              <Button
                variant="quiet"
                onClick={() => {
                  setEmoji(null);
                  setPicking(false);
                }}
              >
                No emoji
              </Button>
            </div>
          </div>
        )}
        <GroupRow label="Group" htmlFor="cat-group">
          <span className="relative flex items-center text-ink-muted">
            <select
              id="cat-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="min-h-11 appearance-none bg-transparent pr-6 text-right text-ink outline-none"
            >
              {groups
                .filter((g) => g.kind === kind)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
            <span className="pointer-events-none absolute right-0">
              <Icon name="chevronDown" size={18} />
            </span>
          </span>
        </GroupRow>
      </Group>

      {kind === 'expense' && (
        <Group title="Budget">
          <GroupRow
            label="Counts toward the budget"
            hint={
              budgeted
                ? 'Shows up in Budget and Ready to assign, like any spending category.'
                : 'Hidden from Budget and Ready to assign — for transfers and card payments.'
            }
          >
            <Toggle label="Counts toward the budget" on={budgeted} onChange={setBudgeted} />
          </GroupRow>
        </Group>
      )}
      {kind === 'expense' && (
        <Group title="Month end">
          <GroupRow
            label="Leftover carries into next month"
            hint={
              roll
                ? 'Unspent money stays here and builds up. Overspending always carries.'
                : 'Unspent money goes back to Ready to assign. Overspending still carries.'
            }
          >
            <Toggle label="Leftover carries into next month" on={roll} onChange={setRoll} />
          </GroupRow>
          <GroupRow
            label="Spent all at once, like a bill"
            hint={
              once
                ? 'Pace waits for the charge instead of expecting it spread through the month.'
                : 'Pace expects spending spread evenly through the month.'
            }
          >
            <Toggle label="Spent all at once, like a bill" on={once} onChange={setOnce} />
          </GroupRow>
        </Group>
      )}
      {(roll !== (category.rolloverPolicy === 'roll') ||
        once !== (category.spendShape === 'fixed')) && (
        <p className="mt-2 px-1 type-caption text-ink-muted">
          Takes effect at the next month end. Months already closed stay as they are.
        </p>
      )}

      {error && <p className="mt-4 px-1 text-clay">{error}</p>}

      <div className="mt-8">
        {confirmDelete ? (
          <div className="rounded-card bg-surface p-4 shadow-soft">
            <p className="font-medium">Delete {category.name}?</p>
            <p className="mt-1 type-caption text-ink-muted">
              Past transactions and history keep it.
              {ruleCount > 0 &&
                ` ${ruleCount} ${ruleCount === 1 ? 'rule that files' : 'rules that file'} into it will be deleted too.`}
            </p>
            {deleteError && <p className="mt-2 type-caption text-clay">{deleteError}</p>}
            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                className="flex-1 border border-clay"
                disabled={busy || deleteError !== null}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('DELETE', `/categories/${category.id}`);
                    await Promise.all([
                      invalidate(),
                      qc.invalidateQueries({ queryKey: ['rules'] }),
                    ]);
                    onClose();
                    onDeleted?.();
                  } catch (e) {
                    const month =
                      e instanceof ApiError && e.code === 'CATEGORY_IN_USE'
                        ? (e.detail as { periodId?: string } | undefined)?.periodId
                        : undefined;
                    setDeleteError(
                      month
                        ? `It still has money or spending in ${monthName(month, false)}. Set its plan to $0 and move its transactions to another category, then delete it.`
                        : e instanceof ApiError
                          ? e.message
                          : 'Could not delete. Try again.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete
              </Button>
              <Button
                variant="quiet"
                className="flex-1"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-12 w-full rounded-card bg-surface font-medium text-clay shadow-soft active:bg-clay-100"
          >
            Delete category
          </button>
        )}
      </div>
    </Sheet>
  );
}
