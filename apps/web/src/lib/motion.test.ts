import { describe, expect, it } from 'vitest';
import css from '../styles.css?raw';
import { MOTION_EASE, MOTION_IN_MS, MOTION_OUT_MS } from './motion';

const token = (name: string) => css.match(new RegExp(`--motion-${name}:\\s*([^;]+);`))?.[1];

describe('motion tokens', () => {
  it('styles.css and motion.ts agree', () => {
    expect(token('ease')).toBe(MOTION_EASE);
    expect(token('in')).toBe(`${MOTION_IN_MS}ms`);
    expect(token('out')).toBe(`${MOTION_OUT_MS}ms`);
  });
});
