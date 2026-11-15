import { describe, it, expect } from 'vitest';
import {
  buildDogePhrases, generateDogeTexts, seededRng, shortenCity, readableColors,
  contrast, DOGE_BG, DOGE_OUTLINE, DOGE_PREFIXES,
} from '../components/generative/dogeSpeak';

describe('dogeSpeak', () => {
  it('is deterministic for the same seed + city', () => {
    expect(buildDogePhrases('evt1|0', 'Buenos Aires')).toEqual(buildDogePhrases('evt1|0', 'Buenos Aires'));
    const a = seededRng('x');
    const b = seededRng('x');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('changes when the seed changes (shuffle wow)', () => {
    const seen = new Set(
      Array.from({ length: 8 }, (_, i) => JSON.stringify(buildDogePhrases(`evt1|${i}`, 'Buenos Aires'))),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('builds 5 event phrases in doge style', () => {
    const p = buildDogePhrases('evt1|0', 'Buenos Aires');
    expect(p).toHaveLength(5);
    expect(p[0].text).toBe('wow');
    expect(p[1].text).toMatch(/ pizza$/);
    expect(p[2].text).toMatch(/ party$/);
    expect(p[3].text).toBe('so doge day');
    expect(p[4].text).toMatch(/ buenos aires$/);
    expect(DOGE_PREFIXES).toContain(p[1].text.split(' ')[0]);
  });

  it('shortens long city names', () => {
    expect(shortenCity('San Francisco Bay Area')).toBe('san francisco');
    expect(shortenCity('Austin, TX')).toBe('austin');
    expect(shortenCity('Supercalifragilisticexpialidocious').length).toBeLessThanOrEqual(14);
    const p = buildDogePhrases('e|0', 'San Francisco Bay Area');
    expect(p[4].text).toMatch(/ san francisco$/);
  });

  it('falls back to an adjective without a city', () => {
    const p = buildDogePhrases('e|0', 'YOUR CITY');
    expect(p[4].text).not.toMatch(/your city/);
  });

  it('ports generateDogeTexts: 5 phrases starting with wow', () => {
    const t = generateDogeTexts('pizza', seededRng('s'));
    expect(t).toHaveLength(5);
    expect(t[0]).toBe('wow');
  });

  it('only uses colors that stay readable on cream', () => {
    const colors = readableColors();
    expect(colors.length).toBeGreaterThanOrEqual(5);
    expect(contrast(DOGE_OUTLINE, DOGE_BG)).toBeGreaterThanOrEqual(4.5);
    for (const c of colors) expect(contrast(c, DOGE_OUTLINE)).toBeGreaterThanOrEqual(2.5);
    for (const { color } of buildDogePhrases('e|0', 'Lima')) expect(colors).toContain(color);
  });
});
