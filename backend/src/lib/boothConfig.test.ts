import { describe, it, expect } from 'vitest';
import { sanitizeBoothConfig, BOOTH_NAMES_MAX } from './boothConfig.js';

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG}`;

function ok(input: unknown) {
  const r = sanitizeBoothConfig(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.status} ${r.message}`);
  return r.config as any;
}

describe('sanitizeBoothConfig', () => {
  it('rejects non-objects', () => {
    for (const bad of [null, 'x', 5, [], undefined]) {
      const r = sanitizeBoothConfig(bad);
      expect(r.ok).toBe(false);
    }
  });

  it('drops unknown top-level keys and keeps allowed ones', () => {
    const c = ok({ title: 'Party', evil: { a: 1 }, __proto__x: 1, place: 'Rome' });
    expect(c.title).toBe('Party');
    expect(c.place).toBe('Rome');
    expect(c.evil).toBeUndefined();
    expect(c.__proto__x).toBeUndefined();
  });

  it('forces version 1 and credit true', () => {
    const c = ok({ version: 7, credit: false });
    expect(c.version).toBe(1);
    expect(c.credit).toBe(true);
    expect(ok({}).credit).toBe(true);
  });

  it('keeps empty, png data URL and https logos', () => {
    expect(ok({ brand: { logo: '' } }).brand.logo).toBe('');
    expect(ok({ brand: { logo: PNG_URL } }).brand.logo).toBe(PNG_URL);
    expect(ok({ brand: { logo: 'https://example.com/l.png' } }).brand.logo).toBe('https://example.com/l.png');
  });

  it('removes svg, javascript:, http and mismatched-bytes logos', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const fakePng = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    for (const logo of [svg, 'javascript:alert(1)', 'http://example.com/l.png', fakePng, 'data:text/html;base64,AAAA', 42]) {
      expect(ok({ brand: { logo } }).brand.logo).toBe('');
    }
  });

  it('always sets a logo string on brand', () => {
    expect(ok({ brand: { name: 'X' } }).brand.logo).toBe('');
  });

  it('keeps only https for share.link and brand.website', () => {
    expect(ok({ share: { link: 'https://rsv.pizza/x' } }).share.link).toBe('https://rsv.pizza/x');
    expect(ok({ share: { link: 'http://rsv.pizza/x' } }).share.link).toBe('');
    expect(ok({ share: { link: 'javascript:alert(1)' } }).share.link).toBe('');
    expect(ok({ brand: { website: 'http://a.test' } }).brand.website).toBe('');
    expect(ok({ brand: { website: 'https://a.test' } }).brand.website).toBe('https://a.test');
  });

  it('drops bad colours and keeps #RRGGBB', () => {
    const c = ok({ brand: { colors: { accent: '#FF393A', base: 'red', text: '#fff', highlight: 'url(x)' } } });
    expect(c.brand.colors).toEqual({ accent: '#FF393A' });
  });

  it('strips control and bidi characters from strings', () => {
    const c = ok({ title: 'A\u0000B‮C⁦D\u0007E', words: { 'neon.sign': { text: 'x‪y' } } });
    expect(c.title).toBe('ABCDE');
    expect(c.words['neon.sign'].text).toBe('xy');
  });

  it('caps person.names at 5000 entries', () => {
    const names = Array.from({ length: BOOTH_NAMES_MAX + 100 }, (_, i) => `n${i}`);
    expect(ok({ person: { names } }).person.names).toHaveLength(BOOTH_NAMES_MAX);
  });

  it('does not copy prototype-pollution keys', () => {
    const input = JSON.parse('{"words":{"__proto__":{"polluted":true},"a":{"text":"ok"}}}');
    const c = ok(input);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(c.words, '__proto__')).toBe(false);
    expect(c.words.a.text).toBe('ok');
  });

  it('returns 413 over 1.8 MB', () => {
    const r = sanitizeBoothConfig({ title: 'x'.repeat(1.9 * 1024 * 1024) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });
});
