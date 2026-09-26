/** The handful of line icons Rise uses, drawn on a 24px grid at 1.75 stroke. */
const PATHS = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  bank: 'M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l5 5L20 7',
  chevronDown: 'M6 9l6 6 6-6',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10M16 13.5h.01',
  flow: 'M4 6h4v4H4zM4 14h4v4H4zM16 10h4v4h-4zM8 8h4a4 4 0 0 1 4 4M8 16h4a4 4 0 0 1 4-4',
  // A cog (gear), not the sun this path used to draw — teeth, not rays.
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.5H2.9a2 2 0 0 1 0-4H3a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19 9c.11.4.32.76.63 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="shrink-0 fill-none stroke-current"
      strokeWidth={name === 'more' ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A 44px round icon button for page headers. */
export function IconButton({
  icon,
  label,
  onClick,
  badge,
  iconClassName,
  disabled,
  ...rest
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  badge?: number | undefined;
  iconClassName?: string | undefined;
  disabled?: boolean;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="relative flex size-11 items-center justify-center rounded-full text-ink active:bg-sage-100 disabled:opacity-30"
      {...rest}
    >
      <span className={iconClassName}>
        <Icon name={icon} />
      </span>
      {badge ? (
        <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-sage-600 px-1 text-[10px] leading-4 font-semibold text-surface">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
