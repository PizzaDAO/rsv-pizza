import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));

import type { IndexRow } from './pizzaIndex.service.js';
import {
  buildPriceDocument,
  isoCountry,
  PRIOR_ROW_KEYS,
  roundTo25,
  sizeBucketFromCm,
  stateFromAddress,
} from './pricePriors.service.js';

const NOW = new Date('2026-11-09T12:00:00Z');
let seq = 0;

/** A US event line: $price for a round pie of `cm`, at merchant `m`. */
function line(p: Partial<IndexRow> & { eventKey: string; price?: number }): IndexRow {
  const price = p.price ?? 20;
  const d = p.diameterCm ?? 35.56; // 14 in
  return {
    lineId: `l${++seq}`, documentId: `d${seq}`, partyId: p.eventKey, partyName: `Secret Party ${p.eventKey}`,
    country: 'United States', city: 'Boston', region: 'usa', eventYear: 2026, eventSeriesSlug: 'gpp2026',
    documentUrl: 'https://x/receipt.jpg', documentMimeType: 'image/jpeg', sourceReceiptIndex: null, sourceReceiptCount: null,
    merchant: `Sal's ${p.eventKey}`, merchantKey: `m-${p.eventKey}`, rawName: 'Pepperoni', qty: 1,
    currency: 'USD', fxRate: 1, unitPriceList: price, unitPriceNet: null, unitPriceUsd: price, unitPriceNetUsd: null,
    sizeLabel: 'large', shape: 'round', diameterCm: d, areaCm2: Math.PI * (d / 2) ** 2, style: null,
    sizeSource: 'parsed', sizeConfidence: 0.95, verifiedAt: null, verifiedBy: 'admin@x.com', isVerified: false,
    outlierFlag: false, isBundle: false, usdPerCm2: price / (Math.PI * (d / 2) ** 2), localPerCm2: 0.02,
    netUsdPerCm2: null, origin: 'event', fxSource: null, isLumpSum: false, ...p,
  };
}

const states = (ids: string[], code = 'MA') => new Map(ids.map((i) => [i, code]));
const doc = (rows: IndexRow[], st?: Map<string, string | null>) => buildPriceDocument(rows, { now: NOW, states: st });

describe('helpers', () => {
  it('size buckets use pizza-mcp thresholds (inches)', () => {
    expect(sizeBucketFromCm(25)).toBe('small');
    expect(sizeBucketFromCm(25.4)).toBe('small'); // 10 in
    expect(sizeBucketFromCm(30)).toBe('medium');
    expect(sizeBucketFromCm(30.48)).toBe('medium'); // 12 in
    expect(sizeBucketFromCm(35)).toBe('large');
    expect(sizeBucketFromCm(35.56)).toBe('large'); // 14 in
    expect(sizeBucketFromCm(40)).toBe('xl');
  });
  it('rounds to 25 cents', () => {
    expect(roundTo25(1912)).toBe(1900);
    expect(roundTo25(1913)).toBe(1925);
    expect(roundTo25(2000)).toBe(2000);
  });
  it('country names and codes become ISO2', () => {
    expect(isoCountry('United States')).toBe('US');
    expect(isoCountry('us')).toBe('US');
    expect(isoCountry('Canada')).toBe('CA');
    expect(isoCountry(null)).toBeNull();
  });
  it('reads the state from a formatted address only', () => {
    expect(stateFromAddress('1 Main St, Boston, MA 02110, USA', 'US')).toBe('MA');
    expect(stateFromAddress('Boston, Massachusetts, United States', 'US')).toBe('MA');
    expect(stateFromAddress('100 King St W, Toronto, ON M5X 1A9, Canada', 'CA')).toBe('ON');
    expect(stateFromAddress('Boston', 'US')).toBeNull();
    expect(stateFromAddress('MG Road, Bengaluru, Karnataka 560001, India', 'IN')).toBeNull();
    expect(stateFromAddress(null, 'US')).toBeNull();
  });
});

describe('buildPriceDocument', () => {
  it('publishes city, state and country rows with n = distinct events and p50/p80 over event medians', () => {
    const rows = [
      line({ eventKey: 'a', price: 18 }),
      line({ eventKey: 'a', price: 30, qty: 0.5 }), // a's weighted median stays 18
      line({ eventKey: 'b', price: 20 }),
      line({ eventKey: 'c', price: 22 }),
    ];
    const d = doc(rows, states(['a', 'b', 'c']));
    expect(d.v).toBe(1);
    expect(d.generated_at).toBe(NOW.toISOString());
    expect(d.rows.map((r) => r.region)).toEqual(['city:US-MA:boston', 'country:US', 'state:US-MA']);
    for (const r of d.rows) {
      expect(r).toEqual({
        region: r.region, size_bucket: 'large', topping_count: 2, currency: 'USD',
        p50_cents: 2000, p80_cents: 2125, n: 3, tax_included: false, as_of_year: 2026,
      });
    }
  });

  it('without a state, a US city gets no key (only country)', () => {
    const d = doc(['a', 'b', 'c'].map((e) => line({ eventKey: e })));
    expect(d.rows.map((r) => r.region)).toEqual(['country:US']);
  });

  it('needs 3 events: two parties with many lines are not enough', () => {
    const rows = ['a', 'a', 'a', 'b', 'b'].map((e) => line({ eventKey: e }));
    expect(doc(rows).rows).toEqual([]);
  });

  it('needs 2 distinct known merchants: one shop never stands in for a region', () => {
    const one = ['a', 'b', 'c'].map((e) => line({ eventKey: e, merchantKey: 'same-shop' }));
    expect(doc(one).rows).toEqual([]);
    const unknown = ['a', 'b', 'c'].map((e) => line({ eventKey: e, merchantKey: null }));
    expect(doc(unknown).rows).toEqual([]);
    const two = ['a', 'b', 'c'].map((e, i) => line({ eventKey: e, merchantKey: i ? 'shop-2' : 'shop-1' }));
    expect(doc(two).rows).toHaveLength(1);
  });

  it('splits plain and specialty into topping_count 0 and 2', () => {
    const rows = [
      ...['a', 'b', 'c'].map((e) => line({ eventKey: e, rawName: 'Cheese Pizza', price: 16 })),
      ...['a', 'b', 'c'].map((e) => line({ eventKey: e, rawName: 'Supreme', price: 24 })),
    ];
    const d = doc(rows);
    expect(d.rows.map((r) => [r.topping_count, r.p50_cents])).toEqual([[0, 1600], [2, 2400]]);
  });

  it('buckets by diameter and leaves out rect, slice, unknown sizes, bundles, lump sums, low confidence and outliers', () => {
    const ok = (e: string, p: Partial<IndexRow> = {}) => line({ eventKey: e, ...p });
    const rows = [
      ...['a', 'b', 'c'].map((e) => ok(e, { diameterCm: 30 })), // medium
      ok('d', { shape: 'rect' }), ok('e', { shape: 'slice' }), ok('f', { diameterCm: null }),
      ok('g', { isBundle: true }), ok('h', { isLumpSum: true }), ok('i', { sizeConfidence: 0.5 }),
      ok('j', { outlierFlag: true }),
    ];
    const d = doc(rows);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ size_bucket: 'medium', n: 3 });
  });

  it('a verified outlier counts', () => {
    const rows = ['a', 'b', 'c'].map((e) => line({ eventKey: e, outlierFlag: true, isVerified: true }));
    expect(doc(rows).rows).toHaveLength(1);
  });

  it('keeps only event years >= last year', () => {
    const rows = ['a', 'b', 'c'].map((e, i) => line({ eventKey: e, eventYear: i ? 2025 : 2024 }));
    expect(doc(rows).rows).toEqual([]);
    const recent = ['a', 'b', 'c'].map((e, i) => line({ eventKey: e, eventYear: i ? 2025 : 2026 }));
    expect(doc(recent).rows[0].as_of_year).toBe(2026);
  });

  it('Canada exports CAD list prices (CAD lines only); elsewhere USD, VAT-inclusive outside US/CA', () => {
    const ca = ['a', 'b', 'c'].map((e) => line({ eventKey: e, country: 'Canada', city: 'Toronto', currency: 'CAD', unitPriceList: 27, unitPriceUsd: 19.5 }));
    const caUsd = line({ eventKey: 'd', country: 'Canada', currency: 'USD', unitPriceList: 10 });
    const d = doc([...ca, caUsd], states(['a', 'b', 'c'], 'ON'));
    expect(d.rows.map((r) => [r.region, r.currency, r.p50_cents, r.n, r.tax_included])).toEqual([
      ['city:CA-ON:toronto', 'CAD', 2700, 3, false],
      ['country:CA', 'CAD', 2700, 3, false],
      ['state:CA-ON', 'CAD', 2700, 3, false],
    ]);
    const india = ['a', 'b', 'c'].map((e) => line({ eventKey: e, country: 'India', city: 'Bangalore', currency: 'INR', unitPriceList: 600, unitPriceUsd: 7.2 }));
    const di = doc(india);
    expect(di.rows.map((r) => [r.region, r.currency, r.p50_cents, r.tax_included])).toEqual([
      ['city:IN:bengaluru', 'USD', 725, true],
      ['country:IN', 'USD', 725, true],
    ]);
  });

  it('history and submission origins count by eventKey (one city-year / one pizzeria-city-year)', () => {
    const rows = [
      line({ eventKey: 'hist:2026:Boston|United States', partyId: null, origin: 'history' }),
      line({ eventKey: 'sub:2026:m1|Boston|United States', partyId: null, origin: 'submission', merchantKey: 'm1' }),
      line({ eventKey: 'p1' }),
    ];
    expect(doc(rows).rows[0].n).toBe(3);
  });

  it('drops rows outside pizza-mcp bounds instead of shipping a document it would reject', () => {
    const cheap = ['a', 'b', 'c'].map((e) => line({ eventKey: e, price: 0.5 }));
    expect(doc(cheap).rows).toEqual([]);
    const dear = ['a', 'b', 'c'].map((e) => line({ eventKey: e, price: 150 }));
    expect(doc(dear).rows).toEqual([]);
  });

  it('contains no PII: only the nine contract keys, and no party, merchant, name or URL strings', () => {
    const rows = ['a', 'b', 'c'].map((e) => line({ eventKey: e }));
    const d = doc(rows, states(['a', 'b', 'c']));
    expect(Object.keys(d).sort()).toEqual(['generated_at', 'rows', 'v']);
    for (const r of d.rows) expect(Object.keys(r).sort()).toEqual([...PRIOR_ROW_KEYS].sort());
    const s = JSON.stringify(d);
    for (const leak of ['Secret Party', "Sal's", 'm-a', 'receipt.jpg', 'admin@x.com', 'Pepperoni', '"a"']) {
      expect(s).not.toContain(leak);
    }
  });
});
