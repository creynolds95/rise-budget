import type { AccountBadgeStyle } from '@rise/shared/schemas';
import { useEffect, useState } from 'react';
import { BADGE_BACKGROUNDS, BADGE_TEXT_COLORS } from '../lib/institution';
import { CustomBadge } from './AccountLogo';
import { Button } from './primitives/Button';
import { Sheet } from './primitives/Sheet';

/** Letters and two colors for an account whose bank Rise has no logo for. */
export function BadgeEditorSheet({
  open,
  initial,
  canReset,
  onDone,
  onReset,
  onClose,
}: {
  open: boolean;
  initial: AccountBadgeStyle;
  /** A custom badge exists (saved or drafted), so going back to automatic means something. */
  canReset: boolean;
  onDone: (b: AccountBadgeStyle) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [b, setB] = useState(initial);
  useEffect(() => {
    if (open) setB(initial);
    // Only re-seed when the sheet opens; typing must not be reset by the parent re-rendering.
  }, [open]);
  const text = b.text.trim();

  return (
    <Sheet
      open={open}
      title="Icon"
      onClose={onClose}
      action={{ label: 'Done', disabled: !text, onClick: () => onDone({ ...b, text }) }}
    >
      <div className="flex flex-col gap-5">
        <div className="flex justify-center py-2">
          <span className="origin-center scale-[2]">
            <CustomBadge text={text || ' '} bg={b.bg} fg={b.fg} />
          </span>
        </div>
        <label className="mt-2 flex flex-col gap-1">
          <span className="type-label text-ink-muted">Letters</span>
          <input
            className="min-h-11 w-full rounded-input border border-hairline bg-surface px-3 focus:border-sage-600 focus:outline-none"
            value={b.text}
            maxLength={4}
            autoCapitalize="characters"
            onChange={(e) => setB({ ...b, text: e.target.value })}
          />
        </label>
        <Swatches
          label="Background"
          colors={BADGE_BACKGROUNDS}
          value={b.bg}
          onChange={(bg) => setB({ ...b, bg })}
        />
        <Swatches
          label="Letters color"
          colors={BADGE_TEXT_COLORS}
          value={b.fg}
          onChange={(fg) => setB({ ...b, fg })}
        />
        {canReset && (
          <Button variant="quiet" onClick={onReset}>
            Use automatic icon
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: readonly string[];
  value: string;
  onChange: (c: string) => void;
}) {
  const custom = !colors.includes(value.toLowerCase());
  const ring = (on: boolean) =>
    on ? 'ring-2 ring-sage-600 ring-offset-2 ring-offset-surface' : 'ring-1 ring-hairline';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 type-label text-ink-muted">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={`size-9 rounded-full ${ring(value.toLowerCase() === c)}`}
            style={{ background: c }}
          />
        ))}
        <label
          className={`relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full text-ink-muted ${ring(custom)}`}
          style={custom ? { background: value } : undefined}
        >
          {!custom && <span aria-hidden>+</span>}
          <input
            type="color"
            aria-label={`Other ${label.toLowerCase()}`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}
