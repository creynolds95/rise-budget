/** A key on the amount keypad. Plans are whole dollars, so there's no decimal point. */
export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'back';

/**
 * What the amount reads after one key press. `fresh` means the whole amount is selected, as it
 * is when the editor opens: the next digit replaces it, and delete clears it.
 */
export function pressKey(text: string, key: Key, fresh: boolean): string {
  if (key === 'back') return fresh ? '' : text.slice(0, -1);
  const base = fresh ? '' : text;
  if (base.replace(/^0+/, '').length >= 7) return base;
  return base === '0' ? key : base + key;
}
