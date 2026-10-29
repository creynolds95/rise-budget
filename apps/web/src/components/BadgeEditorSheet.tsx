import { BADGE_ICONS, type AccountBadgeIcon, type AccountBadgeStyle } from '@rise/shared/schemas';
import { useEffect, useState } from 'react';
import { BADGE_BACKGROUNDS, BADGE_TEXT_COLORS, defaultLetters } from '../lib/institution';
import { CustomBadge, SymbolBadge } from './AccountLogo';
import { Button } from './primitives/Button';
import { Icon } from './primitives/Icon';
import { Sheet } from './primitives/Sheet';

type Mode = 'symbol' | 'letters';

/** What an account without a bank logo shows: an outline symbol, or letters on a color. */
export function BadgeEditorSheet({
  open,
  initial,
  initials,
  onDone,
  onReset,
  onClose,
}: {
  open: boolean;
  /** The chosen badge (saved or drafted); null while the automatic one shows. */
  initial: AccountBadgeStyle | null;
  /** The automatic initials, where the letters editor starts. */
  initials: string | null;
  onDone: (b: AccountBadgeStyle) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const start = () => ({
    mode: (initial && 'text' in initial ? 'letters' : 'symbol') as Mode,
    icon: initial && 'icon' in initial ? initial.icon : null,
    letters: initial && 'text' in initial ? initial : defaultLetters(initials),
  });
  const [mode, setMode] = useState<Mode>(() => start().mode);
  const [icon, setIcon] = useState<AccountBadgeIcon | null>(() => start().icon);
  const [letters, setLetters] = useState(() => start().letters);
  useEffect(() => {
    if (!open) return;
    const s = start();
    setMode(s.mode);
    setIcon(s.icon);
    setLetters(s.letters);
    // Only re-seed when the sheet opens; typing must not be reset by the parent re-rendering.
  }, [open]);
  const text = letters.text.trim();
  const ready = mode === 'symbol' ? icon !== null : text !== '';

  return (
    <Sheet
      open={open}
      title="Icon"
      onClose={onClose}
      action={{
        label: 'Done',
        disabled: !ready,
        onClick: () => onDone(mode === 'symbol' && icon ? { icon } : { ...letters, text }),
      }}
    >
      <div className="flex flex-col gap-5">
        <div className="flex justify-center py-5">
          <span className="origin-center scale-[2]">
            {mode === 'symbol' ? (
              <SymbolBadge icon={icon} />
            ) : (
              <CustomBadge text={text || ' '} bg={letters.bg} fg={letters.fg} />
            )}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 rounded-input bg-sage-100 p-1" role="tablist">
          {(['symbol', 'letters'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-9 rounded-input ${mode === m ? 'bg-surface font-semibold shadow-soft' : 'text-ink-muted'}`}
            >
              {m === 'symbol' ? 'Symbols' : 'Letters'}
            </button>
          ))}
        </div>
        {mode === 'symbol' ? (
          <div className="grid grid-cols-4 gap-3">
            {BADGE_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                aria-label={i}
                aria-pressed={icon === i}
                onClick={() => setIcon(i)}
                className={`flex aspect-square items-center justify-center rounded-card text-sage-700 ${icon === i ? 'bg-sage-100 ring-2 ring-sage-600' : 'ring-1 ring-hairline'}`}
              >
                <Icon name={i} size={26} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="type-label text-ink-muted">Letters</span>
              <input
                className="min-h-11 w-full rounded-input border border-hairline bg-surface px-3 focus:border-sage-600 focus:outline-none"
                value={letters.text}
                maxLength={4}
                autoCapitalize="characters"
                onChange={(e) => setLetters({ ...letters, text: e.target.value })}
              />
            </label>
            <Swatches
              label="Background"
              colors={BADGE_BACKGROUNDS}
              value={letters.bg}
              onChange={(bg) => setLetters({ ...letters, bg })}
            />
            <Swatches
              label="Letters color"
              colors={BADGE_TEXT_COLORS}
              value={letters.fg}
              onChange={(fg) => setLetters({ ...letters, fg })}
            />
          </>
        )}
        {initial && (
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
