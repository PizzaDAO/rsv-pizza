import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseThemeTokens, normalizeThemeTokens, deriveThemeVars, contrastRatio, themeFontHrefs, FONTS,
} from './themeTokens';
import { applyThemeTokens } from './themeRuntime';

const BACKEND = resolve(__dirname, '../../../backend/src/lib');
const fixture = JSON.parse(readFileSync(resolve(BACKEND, 'themeTokens.fixture.json'), 'utf8')) as {
  valid: Array<{ input: unknown; tokens: Record<string, unknown>; vars: Record<string, string> }>;
  contrast: Array<{ a: string; b: string; ratio: number }>;
};

const GOOD = {
  mode: 'dark', bg: '#0b0b10', surface: '#17171f', text: '#f5f5f7', textMuted: '#a8a8b3',
  accent: '#e6212f', onAccent: '#ffffff', border: '#2a2a35', radius: 'pill', fontHeading: 'kanit', fontBody: 'inter',
};

describe('backend/frontend parity', () => {
  it('the two themeTokens.ts files are byte-identical', () => {
    const a = readFileSync(resolve(BACKEND, 'themeTokens.ts'), 'utf8');
    const b = readFileSync(resolve(__dirname, 'themeTokens.ts'), 'utf8');
    expect(b).toBe(a);
  });
  it.each(fixture.valid.map((v, i) => [i, v] as const))('shared fixture case %i: same tokens and same variables as the backend', (_i, c) => {
    const r = parseThemeTokens(c.input, { allowOverrides: true });
    expect(r.ok && r.tokens).toEqual(c.tokens);
    expect(deriveThemeVars(c.tokens as never)).toEqual(c.vars);
  });
  it.each(fixture.contrast)('shared contrast $a on $b', ({ a, b, ratio }) => {
    expect(Math.round(contrastRatio(a, b) * 100) / 100).toBe(ratio);
  });
});

describe('malicious values never reach CSS', () => {
  it.each([
    { ...GOOD, accent: '#fff; background:url(//evil.example.org/x)' },
    { ...GOOD, bg: 'url(https://evil.example.org)' },
    { ...GOOD, fontBody: "inter'; } body { display:none" },
    { ...GOOD, radius: '0; position:fixed' },
    { ...GOOD, overrides: { '--bg-card': 'url(x)' } },
  ])('normalizeThemeTokens rejects %j', (bad) => {
    expect(normalizeThemeTokens(bad)).toBeNull();
  });
  it('only emits fixed font stacks', () => {
    const r = parseThemeTokens(GOOD);
    if (!r.ok) throw new Error('fixture');
    const vars = deriveThemeVars(r.tokens);
    expect(vars['--font-heading']).toBe(FONTS.kanit.family);
    expect(themeFontHrefs(r.tokens)).toEqual([FONTS.kanit.href, FONTS.inter.href]);
  });
});

describe('applyThemeTokens', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.head.querySelectorAll('link[data-wl-font]').forEach((l) => l.remove());
  });

  it('does nothing without tokens, with invalid tokens, or with no config', () => {
    for (const rt of [null, undefined, {}, { tokens: null }, { tokens: { accent: 'red' } }, { tokens: { ...GOOD, bg: 'url(x)' } }]) {
      expect(applyThemeTokens(rt as never)).toBe(false);
    }
    expect(document.documentElement.className).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.head.querySelectorAll('link[data-wl-font]').length).toBe(0);
  });

  it('applies class, variables and font links for a valid dark set; idempotent', () => {
    expect(applyThemeTokens({ tokens: GOOD })).toBe(true);
    expect(applyThemeTokens({ tokens: GOOD })).toBe(true);
    const root = document.documentElement;
    expect(root.classList.contains('wl-theme')).toBe(true);
    expect(root.classList.contains('wl-light')).toBe(false);
    expect(root.style.getPropertyValue('--accent')).toBe('#e6212f');
    expect(root.style.getPropertyValue('--radius-btn')).toBe('9999px');
    const hrefs = Array.from(document.head.querySelectorAll('link[data-wl-font]')).map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual([FONTS.kanit.href, FONTS.inter.href]);
  });

  it('light mode adds wl-light; system fonts add no links', () => {
    const light = { ...GOOD, mode: 'light', bg: '#ffffff', surface: '#ffffff', text: '#111111', textMuted: '#555555', border: '#dddddd', fontHeading: 'system', fontBody: 'system' };
    expect(applyThemeTokens({ tokens: light })).toBe(true);
    expect(document.documentElement.classList.contains('wl-light')).toBe(true);
    expect(document.head.querySelectorAll('link[data-wl-font]').length).toBe(0);
  });
});
