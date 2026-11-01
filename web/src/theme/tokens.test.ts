import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance } from './contrast';
import { cssVariables, isNiche, NICHES, THEMES, type Mode } from './tokens';

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 10);
  });
  it('rejects malformed colours instead of silently passing', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});

describe.each(NICHES)('%s palette', (niche) => {
  describe.each(['light', 'dark'] as Mode[])('%s mode meets WCAG AA', (mode) => {
    const p = THEMES[niche][mode];
    it.each([
      ['text on background', p.text, p.bg, 7],
      ['text on surface', p.text, p.surface, 7],
      ['text on alt surface', p.text, p.surfaceAlt, 7],
      ['muted text on background', p.muted, p.bg, 4.5],
      ['muted text on surface', p.muted, p.surface, 4.5],
      ['muted text on alt surface', p.muted, p.surfaceAlt, 4.5],
      ['button label on brand', p.onBrand, p.brand, 4.5],
      ['brand links on surface', p.brand, p.surface, 4.5],
      ['brand links on background', p.brand, p.bg, 4.5],
      ['success text on surface', p.success, p.surface, 4.5],
      ['danger text on surface', p.danger, p.surface, 4.5],
      ['warning text on surface', p.warning, p.surface, 4.5],
    ])('%s', (_name, fg, bg, minimum) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(minimum);
    });
  });
});

describe('cssVariables', () => {
  it('exposes kebab-case custom properties for every palette entry', () => {
    const vars = cssVariables('legal', 'dark');
    expect(vars['--brand']).toBe(THEMES.legal.dark.brand);
    expect(vars['--on-brand']).toBe(THEMES.legal.dark.onBrand);
    expect(vars['--surface-alt']).toBe(THEMES.legal.dark.surfaceAlt);
    expect(vars['--radius-md']).toBe(THEMES.legal.radius.md);
  });
  it('recognises only known niches', () => {
    expect(isNiche('civic')).toBe(true);
    expect(isNiche('crypto')).toBe(false);
    expect(isNiche(undefined)).toBe(false);
  });
  it('keeps the vocabulary distinct per niche so the UI visibly adapts', () => {
    const words = new Set(NICHES.map((n) => THEMES[n].vocabulary.resources));
    expect(words.size).toBe(NICHES.length);
  });
});
