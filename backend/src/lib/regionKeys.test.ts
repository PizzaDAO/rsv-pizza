/**
 * basil-14648 P2: the shared region-key vectors (byte copy of pizza-mcp
 * tests/fixtures/region-keys.vectors.json). Every case must match, or rsv's
 * price priors would land on keys pizza-mcp never looks up.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CITY_ALIASES, REGION_KEY_RE, regionKeys, slugify, subdivisionCode } from './regionKeys.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '__fixtures__', 'region-keys.vectors.json');
const vectors = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  v: number;
  cases: Array<{ input: { country?: unknown; region?: unknown; city?: unknown }; keys: string[] }>;
};

describe('region keys (shared contract with pizza-mcp)', () => {
  it('has the 63 shared vectors', () => {
    expect(vectors.v).toBe(1);
    expect(vectors.cases).toHaveLength(63);
  });

  for (const [i, c] of vectors.cases.entries()) {
    it(`vector ${i + 1}: ${JSON.stringify(c.input)}`, () => {
      expect(regionKeys(c.input)).toEqual(c.keys);
    });
  }

  it('every vector key matches the grammar', () => {
    for (const c of vectors.cases) for (const k of c.keys) expect(k).toMatch(REGION_KEY_RE);
  });

  it('the grammar refuses junk', () => {
    for (const bad of ['Boston', 'country:usa', 'state:IN-KA', 'city:US-MA:Boston', 'city:US-MA:', 'city:US:a b', 'country:US ']) {
      expect(bad).not.toMatch(REGION_KEY_RE);
    }
  });

  it('slugs fold accents and punctuation', () => {
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify("  St. John's ")).toBe('st-john-s');
    expect(slugify('!!!')).toBe('');
  });

  it('has 64 US/CA subdivisions and 20 city aliases', () => {
    let n = 0;
    for (const cc of ['US', 'CA']) {
      for (const code of 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ')) {
        if (subdivisionCode(cc, code)) n++;
      }
    }
    expect(n).toBe(64);
    expect(Object.keys(CITY_ALIASES)).toHaveLength(20);
  });

  // Drift guard: with a pizza-mcp checkout available, the fixture must be byte-identical to the source of truth.
  const mcp = process.env.PIZZA_MCP_DIR;
  it.skipIf(!mcp)('the fixture is byte-identical to pizza-mcp (PIZZA_MCP_DIR)', () => {
    const theirs = join(mcp!, 'tests', 'fixtures', 'region-keys.vectors.json');
    expect(existsSync(theirs)).toBe(true);
    expect(readFileSync(fixturePath, 'utf8')).toBe(readFileSync(theirs, 'utf8'));
  });
  it.skipIf(!mcp)('the code below the header comment is identical to pizza-mcp region-keys.ts', () => {
    const body = (f: string) => readFileSync(f, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
    expect(body(join(here, 'regionKeys.ts'))).toBe(body(join(mcp!, 'src', 'services', 'region-keys.ts')));
  });
});
