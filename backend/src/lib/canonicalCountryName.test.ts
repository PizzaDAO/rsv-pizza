import { describe, it, expect } from 'vitest';
import { canonicalizeCountryName } from './canonicalCountryName.js';

describe('canonicalizeCountryName', () => {
  it('returns canonical English for canonical English inputs', () => {
    expect(canonicalizeCountryName('Spain')).toBe('Spain');
    expect(canonicalizeCountryName('Germany')).toBe('Germany');
    expect(canonicalizeCountryName('Mexico')).toBe('Mexico');
    expect(canonicalizeCountryName('Japan')).toBe('Japan');
    expect(canonicalizeCountryName('United States')).toBe('United States');
    expect(canonicalizeCountryName('Brazil')).toBe('Brazil');
  });

  it('canonicalizes localized aliases', () => {
    expect(canonicalizeCountryName('España')).toBe('Spain');
    expect(canonicalizeCountryName('Deutschland')).toBe('Germany');
    expect(canonicalizeCountryName('México')).toBe('Mexico');
    expect(canonicalizeCountryName('日本')).toBe('Japan');
    expect(canonicalizeCountryName('中国')).toBe('China');
    expect(canonicalizeCountryName('Brasil')).toBe('Brazil');
    expect(canonicalizeCountryName('Italia')).toBe('Italy');
    expect(canonicalizeCountryName('Perú')).toBe('Peru');
    expect(canonicalizeCountryName('Österreich')).toBe('Austria');
    // Snax-decision (2026-06-06): override Intl's modern CLDR "Türkiye" back
    // to American "Turkey" via the OVERRIDES map. Both input spellings now
    // canonicalize to "Turkey".
    expect(canonicalizeCountryName('Turkey')).toBe('Turkey');
    expect(canonicalizeCountryName('Türkiye')).toBe('Turkey');
  });

  it('applies overrides for codes where Intl is non-American', () => {
    // HK -> Intl "Hong Kong SAR China"
    expect(canonicalizeCountryName('Hong Kong')).toBe('Hong Kong');
    // MO -> Intl "Macao SAR China", existing table has "Macau"
    expect(canonicalizeCountryName('Macau')).toBe('Macao');
    // MM -> Intl "Myanmar (Burma)"
    expect(canonicalizeCountryName('Myanmar')).toBe('Myanmar');
    // CD -> Intl "Congo - Kinshasa"
    expect(canonicalizeCountryName('Democratic Republic of the Congo')).toBe(
      'DR Congo',
    );
    expect(canonicalizeCountryName('DR Congo')).toBe('DR Congo');
    // CG -> Intl "Congo - Brazzaville"
    expect(canonicalizeCountryName('Congo')).toBe('Congo');
    // PS -> Intl "Palestinian Territories"
    expect(canonicalizeCountryName('Palestine')).toBe('Palestine');
    expect(canonicalizeCountryName('Palestinian Territories')).toBe(
      'Palestine',
    );
    // ST -> Intl uses "&" + curly apostrophe
    expect(canonicalizeCountryName('São Tomé and Príncipe')).toBe(
      'São Tomé and Príncipe',
    );
    // TR -> Intl uses modern CLDR "Türkiye"; override to American "Turkey"
    expect(canonicalizeCountryName('Turkey')).toBe('Turkey');
    expect(canonicalizeCountryName('Türkiye')).toBe('Turkey');
  });

  it("normalizes Intl's curly apostrophe in Côte d'Ivoire", () => {
    // Construct curly-apostrophe string explicitly so this test is robust to
    // editor auto-replacement. ’ is RIGHT SINGLE QUOTATION MARK.
    const curly = 'Côte d’Ivoire';
    expect(curly).toBe('Côte d’Ivoire');
    expect(canonicalizeCountryName(curly)).toBe("Côte d'Ivoire");
    // Sanity: the result uses a straight apostrophe, not the curly one.
    expect(canonicalizeCountryName(curly)).not.toContain('’');
    expect(canonicalizeCountryName(curly)).toContain("'");
    // Also accept the ASCII-apostrophe variant on input.
    expect(canonicalizeCountryName("Côte d'Ivoire")).toBe("Côte d'Ivoire");
    // And the existing-table alias "Ivory Coast" should canonicalize to CI.
    expect(canonicalizeCountryName('Ivory Coast')).toBe("Côte d'Ivoire");
  });

  it('trims surrounding whitespace', () => {
    expect(canonicalizeCountryName('  Spain  ')).toBe('Spain');
    expect(canonicalizeCountryName('\tGermany\n')).toBe('Germany');
  });

  it('is case-insensitive on the input side (via getCountryCode)', () => {
    expect(canonicalizeCountryName('spain')).toBe('Spain');
    expect(canonicalizeCountryName('SPAIN')).toBe('Spain');
    expect(canonicalizeCountryName('united kingdom')).toBe('United Kingdom');
  });

  it('returns null for null / undefined / empty / whitespace', () => {
    expect(canonicalizeCountryName(null)).toBeNull();
    expect(canonicalizeCountryName(undefined)).toBeNull();
    expect(canonicalizeCountryName('')).toBeNull();
    expect(canonicalizeCountryName('   ')).toBeNull();
  });

  it('returns null for unrecognized strings', () => {
    expect(canonicalizeCountryName('Atlantis')).toBeNull();
    expect(canonicalizeCountryName('xyzzy')).toBeNull();
  });
});
