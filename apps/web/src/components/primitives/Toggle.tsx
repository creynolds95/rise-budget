/** An on/off switch. The label is the row's text; this is only the control. */
export function Toggle({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-sage-600' : 'bg-hairline'
      }`}
    >
      <span
        className={`absolute top-[2px] left-0 size-[26px] rounded-full bg-surface shadow-soft transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
