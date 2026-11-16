import { describe, it, expect } from 'vitest';
import { buildBoothConfig, cut, diffFromDefault, formatBoothDate } from './buildBoothConfig';
import preset from './pizzadaoPreset.json';

const ORIGIN = 'https://rsv.test';
const event = {
  name: 'Pizza Night',
  city: 'Lisbon',
  address: '1 Main St, Lisbon, Portugal',
  date: '2027-05-22T23:30:00Z',
  timezone: 'America/Los_Angeles',
  customUrl: 'pizza-night',
  inviteCode: 'abc123',
};

describe('buildBoothConfig', () => {
  it('uses the PizzaDAO preset and fills in the party details', () => {
    const c = buildBoothConfig({ event, origin: ORIGIN });
    expect(c.title).toBe('Pizza Night');
    expect(c.place).toBe('Lisbon');
    expect(c.brand.name).toBe('PizzaDAO');
    expect(c.brand.colors).toEqual(preset.brand.colors);
    expect(c.frames.default).toBe('pizza-box');
    expect(c.brand.logo).toBe('https://rsv.test/logo.png');
    expect(c.share.link).toBe('https://rsv.test/pizza-night');
    expect(c.share.text).toBe('Pizza the Planet at Pizza Night {link}');
  });

  it('host values win over the preset and over the party details', () => {
    const c = buildBoothConfig({
      event,
      origin: ORIGIN,
      hostConfig: { title: 'My Booth', brand: { colors: { accent: '#00FF00' } }, frames: { default: 'neon' } },
    });
    expect(c.title).toBe('My Booth');
    expect(c.brand.colors.accent).toBe('#00FF00');
    expect(c.brand.colors.base).toBe(preset.brand.colors.base); // deep merge keeps the rest
    expect(c.frames.default).toBe('neon');
    expect(c.place).toBe('Lisbon'); // host left it unset
  });

  it('party details only fill fields the host left empty', () => {
    const c = buildBoothConfig({ event, origin: ORIGIN, hostConfig: { title: '', place: 'Porto', dates: '' } });
    expect(c.title).toBe('Pizza Night');
    expect(c.place).toBe('Porto');
    expect(c.dates).toBe('Sat 22 May 2027');
  });

  it('caps title/place/dates at 40/30/40 characters', () => {
    const c = buildBoothConfig({ event: { ...event, name: 'N'.repeat(80), city: 'C'.repeat(80) }, origin: ORIGIN });
    expect(c.title).toHaveLength(40);
    expect(c.place).toHaveLength(30);
    expect(c.dates.length).toBeLessThanOrEqual(40);
    expect(cut('a'.repeat(10), 5)).toBe('aaaaa');
  });

  it('place falls back to the first part of the address', () => {
    const c = buildBoothConfig({ event: { ...event, city: null }, origin: ORIGIN });
    expect(c.place).toBe('1 Main St');
  });

  it('formats the date in the party timezone', () => {
    // 23:30 UTC on the 22nd is still the 22nd in Los Angeles, but already the 23rd in Tokyo.
    expect(formatBoothDate('2027-05-22T23:30:00Z', 'America/Los_Angeles')).toBe('Sat 22 May 2027');
    expect(formatBoothDate('2027-05-22T23:30:00Z', 'Asia/Tokyo')).toBe('Sun 23 May 2027');
    expect(formatBoothDate('2027-05-22T23:30:00Z', 'Not/AZone')).toMatch(/2027/);
    expect(formatBoothDate(null, null)).toBe('');
    expect(formatBoothDate('garbage', null)).toBe('');
  });

  it('share.link is https only', () => {
    expect(buildBoothConfig({ event, origin: 'http://localhost:5173' }).share.link).toBe('');
    expect(buildBoothConfig({ event, origin: ORIGIN, hostConfig: { share: { link: 'http://x.test' } } }).share.link).toBe('');
    expect(buildBoothConfig({ event, origin: ORIGIN, hostConfig: { share: { link: 'https://x.test' } } }).share.link).toBe('https://x.test');
    // no placeholder when there is no link
    expect(buildBoothConfig({ event, origin: 'http://localhost:5173' }).share.text).toBe('Pizza the Planet at Pizza Night');
  });

  it('always forces credit, version and the pizza pack', () => {
    const c = buildBoothConfig({ event, origin: ORIGIN, hostConfig: { credit: false, version: 9, packs: ['x'] } });
    expect(c.credit).toBe(true);
    expect(c.version).toBe(1);
    expect(c.packs).toEqual(['pizza']);
  });

  it('white-label: brand name and logo, no Pizza the Planet copy', () => {
    const c = buildBoothConfig({ event, origin: ORIGIN, whiteLabel: { name: 'Acme Slices', logo: '/acme.png' } });
    expect(c.brand.name).toBe('Acme Slices');
    expect(c.brand.logo).toBe('https://rsv.test/acme.png');
    expect(c.brand.website).toBeUndefined();
    expect(c.words).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('Pizza the Planet');
    expect(c.brand.colors).toEqual(preset.brand.colors);
    expect(c.share.text).toBe('Pizza Night {link}');
  });

  it('white-label with an SVG logo leaves the logo blank (the booth takes raster only)', () => {
    const c = buildBoothConfig({ event, origin: ORIGIN, whiteLabel: { name: 'A', logo: '/a.svg' } });
    expect(c.brand.logo).toBe('');
  });

  it('does not mutate the imported preset', () => {
    buildBoothConfig({ event, origin: ORIGIN, hostConfig: { brand: { colors: { accent: '#123456' } } } });
    expect(preset.brand.colors.accent).toBe('#FF393A');
  });
});

describe('diffFromDefault', () => {
  it('keeps only what differs from the defaults', () => {
    const defaults = buildBoothConfig({ event, origin: ORIGIN });
    const edited = { ...defaults, brand: { ...defaults.brand, colors: { ...defaults.brand.colors, accent: '#00FF00' } } };
    expect(diffFromDefault(edited, defaults)).toEqual({ brand: { colors: { accent: '#00FF00' } } });
    expect(diffFromDefault(defaults, defaults)).toEqual({});
  });
});
