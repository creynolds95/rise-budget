import { useEffect, useRef, useState } from 'react';
import { centsToInput, parseMoney } from '../../lib/money';

/**
 * THE edit field (§5.1). The budget row's planned box and every detail page's editable
 * amount are this component, which is what makes the two feel related. Commits on blur or
 * Enter; an unparseable entry reverts rather than guessing.
 */
export function MoneyField({
  cents,
  onCommit,
  label,
  allowNegative = false,
  draft = false,
  className = '',
}: {
  cents: number;
  onCommit: (cents: number) => void;
  /** Accessible name; the visible label lives in the row. */
  label: string;
  allowNegative?: boolean;
  /** Inside a Save-gated form: report every valid keystroke, so tapping Save (which doesn't blur on iOS) never loses the last edit. */
  draft?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(centsToInput(cents));
  const [invalid, setInvalid] = useState(false);
  const typed = useRef(false);
  useEffect(() => {
    if (typed.current) typed.current = false;
    else setText(centsToInput(cents));
  }, [cents]);

  const commit = () => {
    const parsed = parseMoney(text);
    if (parsed === null || (!allowNegative && parsed < 0)) {
      setInvalid(true);
      setText(centsToInput(cents));
      return;
    }
    setInvalid(false);
    setText(centsToInput(parsed));
    if (parsed !== cents) onCommit(parsed);
  };

  return (
    <span
      className={`inline-flex min-h-11 items-center rounded-input border bg-surface px-3 ${
        invalid ? 'border-clay' : 'border-hairline focus-within:border-sage-600'
      } ${className}`}
    >
      <span aria-hidden className="text-ink-muted money">
        $
      </span>
      <input
        aria-label={label}
        aria-invalid={invalid}
        inputMode="decimal"
        className="w-24 bg-transparent text-right money outline-none"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!draft) return;
          const parsed = parseMoney(e.target.value);
          if (parsed === null || (!allowNegative && parsed < 0) || parsed === cents) return;
          typed.current = true;
          onCommit(parsed);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(centsToInput(cents));
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}
