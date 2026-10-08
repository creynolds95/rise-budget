/** The handful of line icons Rise uses, drawn on a 24px grid at 1.75 stroke. */
const PATHS = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  eyeOff:
    'M3 3l18 18M10.6 6.2A9.5 9.5 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.6 3.3M6.7 7.7A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.5-.7M9.9 10a3 3 0 0 0 4.1 4.1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M19 12H5M11 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  bank: 'M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  // Account symbols: plain outlines for the badge picker.
  building: 'M5 21V4h9v17M14 9h5v12M3 21h18M8 8h2M8 12h2M8 16h2',
  car: 'M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4zM3 13h18M7.5 15.5h.01M16.5 15.5h.01',
  coins:
    'M12 5c-4 0-7 1-7 2.5S8 10 12 10s7-1 7-2.5S16 5 12 5zM5 7.5v4C5 13 8 14 12 14s7-1 7-2.5v-4M5 11.5v4C5 17 8 18 12 18s7-1 7-2.5v-4',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  briefcase: 'M4 8h16v11H4zM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16',
  cap: 'M2 9l10-5 10 5-10 5-10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
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
      strokeWidth={name === 'more' ? 3 : name === 'back' ? 2.5 : 1.75}
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
