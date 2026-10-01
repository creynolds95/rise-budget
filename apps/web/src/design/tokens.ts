/**
 * DESIGN-SYSTEM.md §1, for code that needs raw values (charts, the contrast audit).
 * `styles.css` declares the same values as Tailwind theme tokens; a test keeps them equal.
 */
export const color = {
  ink: '#191C16',
  inkMuted: '#5C6157',
  inkFaint: '#8A8F84',
  canvas: '#FAFAF7',
  surface: '#FFFFFF',
  hairline: '#E6E7E1',
  sage700: '#4A6142',
  sage600: '#5F7A55',
  sage300: '#A8BC9F',
  sage100: '#EDF1EA',
  gold: '#C9A24D',
  goldText: '#8A6D22',
  gold100: '#F7F0DE',
  clay: '#A8563C',
  clay100: '#F6E7E1',
} as const;

export type ColorToken = keyof typeof color;

/**
 * Dark-mode values for the same tokens (styles.css, `[data-theme='dark']` and the matching
 * `prefers-color-scheme` block). Brand colors shift brighter since they now sit on dark
 * backgrounds and, in places, carry text themselves.
 */
export const colorDark: Record<ColorToken, string> = {
  ink: '#ECEFE6',
  inkMuted: '#A3AA98',
  inkFaint: '#767C6E',
  canvas: '#14160F',
  surface: '#1E2118',
  hairline: '#2D3226',
  sage700: '#8FB27E',
  sage600: '#7A9A6D',
  sage300: '#435239',
  sage100: '#232B1D',
  gold: '#D4B05B',
  goldText: '#E0BE72',
  gold100: '#2E2712',
  clay: '#D98467',
  clay100: '#3A211A',
};

/** Categorical series order for charts (§7). */
export const series = [color.sage600, color.gold, color.clay, color.sage300] as const;

/**
 * Every text-on-background pairing the app uses. The contrast audit checks each one;
 * a new pairing must be added here to be used. Gold is deliberately absent as a foreground.
 */
export const textPairs: [fg: ColorToken, bg: ColorToken, use: string][] = [
  ['ink', 'canvas', 'body text'],
  ['ink', 'surface', 'body text on raised content'],
  ['inkMuted', 'canvas', 'secondary text'],
  ['inkMuted', 'surface', 'secondary text on raised content'],
  ['inkMuted', 'sage100', 'secondary text on selected rows'],
  ['sage700', 'canvas', 'emphasis text'],
  ['sage700', 'sage100', 'selected tab / chip'],
  ['surface', 'sage600', 'primary button label'],
  ['surface', 'sage700', 'pressed primary button label'],
  ['goldText', 'canvas', 'gold words'],
  ['goldText', 'surface', 'gold words on raised content'],
  ['ink', 'gold100', 'text on gold tint'],
  ['clay', 'canvas', 'overspend figures'],
  ['clay', 'surface', 'overspend on raised content'],
  ['sage700', 'clay100', 'quiet action on deficit tint'],
  ['ink', 'sage100', 'text on selected rows'],
  ['ink', 'clay100', 'text on deficit tint'],
];

/**
 * Timestamps and staleness captions. `ink-faint` is 3.3:1: below AA for body text, so it is
 * only for non-essential text at caption size, and it's audited against AA-large (3:1).
 */
export const captionPairs: [fg: ColorToken, bg: ColorToken, use: string][] = [
  ['inkFaint', 'canvas', 'timestamps'],
  ['inkFaint', 'surface', 'timestamps on raised content'],
];
