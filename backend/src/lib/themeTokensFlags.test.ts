import { describe, it, expect } from 'vitest';
import { parseThemeTokens, deriveThemeVars } from './themeTokens.js';

const GOOD = {
  mode: 'dark', bg: '#0b0b10', surface: '#17171f', text: '#f5f5f7', textMuted: '#a8a8b3',
  accent: '#e6212f', onAccent: '#ffffff', border: '#2a2a35',
};

// Same cases run in frontend/src/config/themeTokensFlags.test.ts (themeTokens.ts is byte-identical in both).
describe('presentation flags (hideHeaderName / hideHeroLogo)', () => {
  it('accepts booleans, keeps only true flags, and they do not change the derived variables', () => {
    const r = parseThemeTokens({ ...GOOD, hideHeaderName: true, hideHeroLogo: false });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.tokens.hideHeaderName).toBe(true);
    expect('hideHeroLogo' in r.tokens).toBe(false);
    const plain = parseThemeTokens(GOOD);
    if (!plain.ok) throw new Error('plain');
    expect(deriveThemeVars(r.tokens)).toEqual(deriveThemeVars(plain.tokens));
  });

  it.each([['string', 'yes'], ['number', 1], ['null', null], ['object', {}]])('rejects a %s flag', (_n, v) => {
    expect(parseThemeTokens({ ...GOOD, hideHeaderName: v }).ok).toBe(false);
    expect(parseThemeTokens({ ...GOOD, hideHeroLogo: v }).ok).toBe(false);
  });

  it('brand admins may set them (they are not overrides)', () => {
    expect(parseThemeTokens({ ...GOOD, hideHeaderName: true, hideHeroLogo: true }, { allowOverrides: false }).ok).toBe(true);
  });
});
