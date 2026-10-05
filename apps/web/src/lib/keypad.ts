/** A key on the amount keypad. */
export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/**
 * What the amount reads after one key press. `fresh` means the whole amount is selected, as it
 * is when the editor opens: the next digit replaces it, and delete clears it.
 */
export function pressKey(text: string, key: Key, fresh: boolean): string {
  if (key === 'back') return fresh ? '' : text.slice(0, -1);
  const base = fresh ? '' : text;
  if (key === '.') {
    if (base.includes('.')) return base;
    return (base || '0') + '.';
  }
  const dot = base.indexOf('.');
  if (dot >= 0 && base.length - dot > 2) return base;
  if (dot < 0 && base.replace(/^0+/, '').length >= 7) return base;
  return base === '0' ? key : base + key;
}
