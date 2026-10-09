import { describe, expect, it } from 'vitest';
import { appHeight } from './appHeight';

const base = { inner: 812, screen: 874, visible: 812, installed: true, portrait: true };

describe('appHeight', () => {
  it('an installed app on a short window takes the screen height', () => {
    expect(appHeight(base)).toBe(874);
  });
  it('a browser tab keeps the window height', () => {
    expect(appHeight({ ...base, installed: false })).toBe(812);
  });
  it('keeps the window height while the keyboard is up', () => {
    expect(appHeight({ ...base, visible: 470 })).toBe(812);
  });
  it('keeps the window height in landscape', () => {
    expect(appHeight({ ...base, portrait: false })).toBe(812);
  });
  it('never shrinks a window already taller than the screen', () => {
    expect(appHeight({ ...base, inner: 900, visible: null })).toBe(900);
  });
});
