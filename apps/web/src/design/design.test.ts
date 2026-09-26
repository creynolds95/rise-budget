import { describe, expect, it } from 'vitest';
import css from '../styles.css?raw';
import { contrast } from './contrast';
import { captionPairs, color, colorDark, textPairs } from './tokens';

const kebab = (k: string) =>
  k
    .replace(/([a-z])(\d)/g, '$1-$2')
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase();

describe('design tokens (DESIGN-SYSTEM.md §1)', () => {
  it('styles.css declares exactly the token values in tokens.ts', () => {
    for (const [name, hex] of Object.entries(color)) {
      expect(css.toLowerCase(), name).toContain(`--color-${kebab(name)}: ${hex.toLowerCase()};`);
    }
    expect(css).toContain('--color-*: initial;');
  });

  it.each(textPairs)('AA contrast: %s on %s (%s)', (fg, bg) => {
    expect(contrast(color[fg], color[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(captionPairs)('caption contrast ≥ 3:1: %s on %s (%s)', (fg, bg) => {
    expect(contrast(color[fg], color[bg])).toBeGreaterThanOrEqual(3);
  });

  it('gold never carries text: it fails AA, and no pairing uses it', () => {
    expect(contrast(color.gold, color.surface)).toBeLessThan(3);
    expect(textPairs.some(([fg]) => fg === 'gold')).toBe(false);
  });
});

describe('dark mode tokens', () => {
  it('styles.css declares exactly the dark-mode token values in tokens.ts', () => {
    for (const [name, hex] of Object.entries(colorDark)) {
      const decl = `--color-${kebab(name)}: ${hex.toLowerCase()};`;
      expect(css.toLowerCase().split(decl).length - 1, name).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(textPairs)('AA contrast in dark mode: %s on %s (%s)', (fg, bg) => {
    expect(contrast(colorDark[fg], colorDark[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(captionPairs)('dark-mode caption contrast ≥ 3:1: %s on %s (%s)', (fg, bg) => {
    expect(contrast(colorDark[fg], colorDark[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe('source rules', () => {
  const sources = import.meta.glob('../**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('no gold text, and no colour outside the tokens', () => {
    for (const [file, src] of Object.entries(sources)) {
      if (file.endsWith('.test.tsx')) continue;
      expect(src, file).not.toMatch(/\btext-gold(?!-text)\b/);
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, file).not.toMatch(/\b(red|blue)-\d{3}\b/);
    }
  });
});
