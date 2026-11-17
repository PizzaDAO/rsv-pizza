import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseThemeTokens, normalizeThemeTokens, deriveThemeVars, contrastRatio, checkThemeContrast,
  themeFontHrefs, FONTS, FONT_KEYS, OVERRIDE_VARS,
} from './themeTokens.js';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./themeTokens.fixture.json', import.meta.url)), 'utf8')) as {
  valid: Array<{ input: unknown; tokens: Record<string, unknown>; vars: Record<string, string> }>;
  contrast: Array<{ a: string; b: string; ratio: number }>;
};

const GOOD = {
  mode: 'dark', bg: '#0b0b10', surface: '#17171f', text: '#f5f5f7', textMuted: '#a8a8b3',
  accent: '#e6212f', onAccent: '#ffffff', border: '#2a2a35',
};

describe('shared fixture (identical test runs in frontend/src/config/themeTokens.test.ts)', () => {
  it.each(fixture.valid.map((v, i) => [i, v] as const))('case %i parses and derives the pinned variables', (_i, c) => {
    const r = parseThemeTokens(c.input, { allowOverrides: true });
    expect(r.ok && r.tokens).toEqual(c.tokens);
    expect(deriveThemeVars(c.tokens as never)).toEqual(c.vars);
  });
  it.each(fixture.contrast)('contrast $a on $b', ({ a, b, ratio }) => {
    expect(Math.round(contrastRatio(a, b) * 100) / 100).toBe(ratio);
  });
});

describe('parseThemeTokens', () => {
  it('accepts a good set, lowercases colours, applies defaults', () => {
    const r = parseThemeTokens({ ...GOOD, accent: '#E6212F' });
    expect(r).toEqual({ ok: true, tokens: { ...GOOD, radius: 'soft', fontHeading: 'system', fontBody: 'system' } });
  });

  it.each([
    ['css injection in a colour', { ...GOOD, accent: '#fff; background:url(//evil.example.org/x)' }],
    ['expression colour', { ...GOOD, bg: 'expression(alert(1))' }],
    ['var() colour', { ...GOOD, text: 'var(--x)' }],
    ['url() colour', { ...GOOD, surface: 'url(https://evil.example.org)' }],
    ['3-digit hex', { ...GOOD, border: '#fff' }],
    ['8-digit hex', { ...GOOD, border: '#ffffffff' }],
    ['named colour', { ...GOOD, bg: 'red' }],
    ['newline in hex', { ...GOOD, bg: '#0b0b10\n' }],
    ['non-string colour', { ...GOOD, bg: 123456 }],
    ['font url', { ...GOOD, fontBody: 'https://evil.example.org/f.css' }],
    ['font family injection', { ...GOOD, fontHeading: "inter'; } body { display:none" }],
    ['prototype font key', { ...GOOD, fontBody: 'constructor' }],
    ['radius px', { ...GOOD, radius: '999px; x:y' }],
    ['radius number', { ...GOOD, radius: 8 }],
    ['bad mode', { ...GOOD, mode: 'auto' }],
    ['unknown key', { ...GOOD, background: '#000000' }],
    ['__proto__ key', JSON.parse('{"__proto__": {"x": 1}, "mode": "dark"}')],
    ['array', [GOOD]],
    ['string', 'x'],
    ['null', null],
  ])('rejects %s', (_n, input) => {
    expect(parseThemeTokens(input).ok).toBe(false);
  });

  it('rejects oversize input', () => {
    const r = parseThemeTokens({ ...GOOD, overrides: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, '#000000'])) }, { allowOverrides: true });
    expect(r.ok).toBe(false);
  });

  it('rejects overrides unless allowed, and validates them', () => {
    const withOv = { ...GOOD, overrides: { '--bg-card': '#1a1b1c' } };
    expect(parseThemeTokens(withOv).ok).toBe(false);
    expect(parseThemeTokens(withOv, { allowOverrides: true }).ok).toBe(true);
    for (const bad of [
      { '--bg-card': 'url(//evil.example.org)' },
      { '--bg-card': '#fff;color:red' },
      { '--bg-card': 'rgb(300, 0, 0)' },
      { '--bg-card': 'rgba(0,0,0,5)' },
      { '--not-allowed': '#000000' },
      { 'background': '#000000' },
      { '--bg-card: red; x': '#000000' },
    ]) {
      expect(parseThemeTokens({ ...GOOD, overrides: bad }, { allowOverrides: true }).ok).toBe(false);
    }
    const ok = parseThemeTokens({ ...GOOD, overrides: { '--bg-overlay': 'rgba(14, 9, 28, 0.55)' } }, { allowOverrides: true });
    expect(ok.ok).toBe(true);
  });

  it('enforces WCAG AA and names the failing pair', () => {
    const r = parseThemeTokens({ ...GOOD, textMuted: '#2a2a35' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(' ')).toMatch(/textMuted on bg/);
    expect(parseThemeTokens({ ...GOOD, onAccent: '#e6212f' }).ok).toBe(false);
    expect(parseThemeTokens({ ...GOOD, accent: '#0b0b11' }).ok).toBe(false); // accent vs bg
    // borderline: #777 on white is 4.48:1 and must fail, #767676 is 4.54:1 and passes
    const light = { ...GOOD, mode: 'light', bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000', onAccent: '#ffffff' };
    expect(parseThemeTokens({ ...light, textMuted: '#777777' }).ok).toBe(false);
    expect(parseThemeTokens({ ...light, textMuted: '#767676' }).ok).toBe(true);
  });

  it('contrast can be skipped for serving, but shape is still enforced', () => {
    expect(normalizeThemeTokens({ ...GOOD, textMuted: '#2a2a35' })).not.toBeNull();
    expect(normalizeThemeTokens({ ...GOOD, accent: 'red' })).toBeNull();
    expect(normalizeThemeTokens(null)).toBeNull();
    expect(normalizeThemeTokens({ accent: '#E6212F' })).toBeNull();
  });
});

describe('deriveThemeVars', () => {
  it('only ever emits hex/rgba/enumerated values', () => {
    const r = parseThemeTokens(GOOD);
    if (!r.ok) throw new Error('fixture');
    const vars = deriveThemeVars(r.tokens);
    const fonts = new Set<string>(Object.values(FONTS).map((f) => f.family));
    for (const [k, v] of Object.entries(vars)) {
      expect(k).toMatch(/^--[a-z-]+$/);
      const known = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [0-9.]+\)|\d+px|dark|light)$/.test(v) || fonts.has(v);
      expect(known, `${k}=${v}`).toBe(true);
    }
  });
  it('light mode uses the dark AA status hues', () => {
    const r = parseThemeTokens({ ...GOOD, mode: 'light', bg: '#ffffff', surface: '#ffffff', text: '#111111', textMuted: '#555555', border: '#dddddd' });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const v = deriveThemeVars(r.tokens);
    expect([v['--success'], v['--warning'], v['--error'], v['--color-scheme']]).toEqual(['#1f7a45', '#8a5a00', '#b3261e', 'light']);
  });
  it('the derived light status hues pass AA on a white page', () => {
    for (const hex of ['#1f7a45', '#8a5a00', '#b3261e']) expect(contrastRatio(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('fonts', () => {
  it('has the required safe list and only fetches from Google Fonts or Fontshare', () => {
    for (const k of ['system', 'kanit', 'inter', 'nunito', 'satoshi']) expect(FONT_KEYS).toContain(k);
    for (const f of Object.values(FONTS)) {
      if (f.href) expect(f.href).toMatch(/^https:\/\/(fonts\.googleapis\.com\/css2\?|api\.fontshare\.com\/v2\/css\?)/);
    }
    expect(themeFontHrefs({ fontHeading: 'system', fontBody: 'system' })).toEqual([]);
    expect(themeFontHrefs({ fontHeading: 'inter', fontBody: 'inter' })).toHaveLength(1);
  });
  it('override list is plain variable names', () => {
    for (const n of OVERRIDE_VARS) expect(n).toMatch(/^--[a-z-]+$/);
  });
  it('checkThemeContrast returns nothing for a passing set', () => {
    expect(checkThemeContrast(GOOD)).toEqual([]);
  });
});
