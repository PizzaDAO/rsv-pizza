import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));

import {
  aggregate,
  buildPublicIndexFromRows,
  publicPartiesByCountry,
  computeOutlierIds,
  median,
  quantile,
  regionToContinent,
  selectRows,
  summarize,
  weightedMedian,
  type IndexRow,
} from './pizzaIndex.service.js';

let seq = 0;
function row(p: Partial<IndexRow> & { partyId: string; usdPerCm2: number }): IndexRow {
  const area = p.areaCm2 ?? 706.9;
  return {
    lineId: `l${++seq}`, documentId: `d${seq}`, partyName: `Party ${p.partyId}`, country: 'India', city: 'Delhi',
    region: 'india', eventYear: 2026, eventSeriesSlug: 'gpp2026', documentUrl: 'https://x/r.jpg', documentMimeType: 'image/jpeg', sourceReceiptIndex: null, sourceReceiptCount: null, merchant: 'M', merchantKey: 'm', rawName: 'Pizza',
    qty: 1, currency: 'INR', fxRate: 0.0105, unitPriceList: 100, unitPriceNet: null,
    unitPriceUsd: p.usdPerCm2 * area, unitPriceNetUsd: null, sizeLabel: 'large', shape: 'round', diameterCm: 30,
    areaCm2: area, style: null, sizeSource: 'parsed', sizeConfidence: 0.95, verifiedAt: null, verifiedBy: null,
    isVerified: false, outlierFlag: false, isBundle: false, localPerCm2: p.usdPerCm2 / 0.0105,
    netUsdPerCm2: null, ...p,
  };
}

describe('stats helpers', () => {
  it('median / quantile', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it('weightedMedian honours weights', () => {
    expect(weightedMedian([[1, 1], [2, 1], [100, 1]])).toBe(2);
    expect(weightedMedian([[1, 10], [2, 1], [100, 1]])).toBe(1);
    expect(weightedMedian([[1, 1], [2, 1]])).toBe(1.5);
    expect(weightedMedian([[5, 0]])).toBeNull();
  });
  it('region -> continent', () => {
    expect(regionToContinent('west-africa')).toBe('Africa');
    expect(regionToContinent('usa')).toBe('North America');
    expect(regionToContinent('nowhere')).toBeNull();
  });
});

describe('selectRows policy', () => {
  const base = row({ partyId: 'a', usdPerCm2: 0.01 });
  it('default: verified OR conf >= 0.8; unverified outliers out; verified outliers in', () => {
    expect(selectRows([base], {})).toHaveLength(1);
    expect(selectRows([{ ...base, sizeConfidence: 0.6 }], {})).toHaveLength(0);
    expect(selectRows([{ ...base, sizeConfidence: 0.6, isVerified: true }], {})).toHaveLength(1);
    expect(selectRows([{ ...base, outlierFlag: true }], {})).toHaveLength(0);
    expect(selectRows([{ ...base, outlierFlag: true, isVerified: true }], {})).toHaveLength(1);
  });
  it('verifiedOnly requires verification', () => {
    expect(selectRows([base], { verifiedOnly: true })).toHaveLength(0);
    expect(selectRows([{ ...base, isVerified: true }], { verifiedOnly: true })).toHaveLength(1);
  });
  it('bundles are out unless included', () => {
    const b = { ...base, isBundle: true };
    expect(selectRows([b], {})).toHaveLength(0);
    expect(selectRows([b], { includeBundles: true })).toHaveLength(1);
  });
});

describe('aggregate', () => {
  it('party value is a qty-weighted median; group value is the median of party values', () => {
    const rows = [
      // party A: 50 cheap pizzas + 1 expensive -> party median is the cheap one
      row({ partyId: 'A', usdPerCm2: 0.01, qty: 50 }),
      row({ partyId: 'A', usdPerCm2: 0.05, qty: 1 }),
      row({ partyId: 'B', usdPerCm2: 0.02, qty: 1 }),
      row({ partyId: 'C', usdPerCm2: 0.03, qty: 1 }),
    ];
    const [g] = aggregate(rows, { level: 'country' });
    expect(g.nParties).toBe(3);
    expect(g.nLines).toBe(4);
    expect(g.nPizzas).toBe(53);
    expect(g.usdPerCm2.median).toBeCloseTo(0.02, 10); // median(0.01, 0.02, 0.03)
    expect(g.published).toBe(true);
  });

  it('one bulk receipt cannot dominate: 100 pizzas = same vote as 1', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.01, qty: 100 }),
      row({ partyId: 'B', usdPerCm2: 0.04, qty: 1 }),
      row({ partyId: 'C', usdPerCm2: 0.05, qty: 1 }),
    ];
    const [g] = aggregate(rows, { level: 'country' });
    expect(g.usdPerCm2.median).toBeCloseTo(0.04, 10);
  });

  it('includes the 25/30/35/40 cm size ladder (USD and local)', () => {
    const rows = ['A', 'B', 'C'].map((p) => row({ partyId: p, usdPerCm2: 0.02 }));
    const [g] = aggregate(rows, { level: 'country' });
    expect(g.ladderUsd['30']).toBeCloseTo(0.02 * 706.858, 2);
    expect(g.ladderUsd['25']).toBeCloseTo(0.02 * 490.874, 2);
    expect(g.ladderUsd['35']).toBeCloseTo(0.02 * 962.113, 2);
    expect(g.ladderUsd['40']).toBeCloseTo(0.02 * 1256.637, 2);
    expect(g.localCurrency).toBe('INR');
    expect(g.localPerCm2).toBeCloseTo(0.02 / 0.0105, 6);
    expect(g.ladderLocal['30']).toBeCloseTo((0.02 / 0.0105) * 706.858, 2);
  });

  it('publishes a country from one party; continent and city need >= 3', () => {
    const one = [row({ partyId: 'A', usdPerCm2: 0.01 })];
    expect(aggregate(one, { level: 'country' })[0].published).toBe(true);
    const two = [row({ partyId: 'A', usdPerCm2: 0.01 }), row({ partyId: 'B', usdPerCm2: 0.02 })];
    expect(aggregate(two, { level: 'continent' })[0].published).toBe(false);
    expect(aggregate(two, { level: 'city', publishedOnly: true })).toHaveLength(0);
    const three = ['A', 'B', 'C'].map((p) => row({ partyId: p, usdPerCm2: 0.01 }));
    expect(aggregate(three, { level: 'continent' })[0].published).toBe(true);
  });

  it('local figures only use the modal currency', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.01 }),
      row({ partyId: 'B', usdPerCm2: 0.01 }),
      row({ partyId: 'C', usdPerCm2: 0.01, currency: 'USD', localPerCm2: 0.01 }),
    ];
    const s = summarize(rows);
    expect(s.localCurrency).toBe('INR');
    expect(s.localNParties).toBe(2);
  });

  it('net price falls back to list when there is no discount', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.02, netUsdPerCm2: 0.018 }),
      row({ partyId: 'B', usdPerCm2: 0.02 }),
      row({ partyId: 'C', usdPerCm2: 0.02 }),
    ];
    const [g] = aggregate(rows, { level: 'country' });
    expect(g.usdPerCm2.median).toBeCloseTo(0.02, 10);
    expect(g.netUsdPerCm2).toBeCloseTo(0.02, 10); // median(0.018, 0.02, 0.02)
  });

  it('bundle toggle changes the medians', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.02 }),
      row({ partyId: 'B', usdPerCm2: 0.02 }),
      row({ partyId: 'C', usdPerCm2: 0.02 }),
      row({ partyId: 'D', usdPerCm2: 0.001, isBundle: true }),
      row({ partyId: 'E', usdPerCm2: 0.001, isBundle: true }),
      row({ partyId: 'F', usdPerCm2: 0.001, isBundle: true }),
    ];
    expect(aggregate(rows, { level: 'country' })[0].nParties).toBe(3);
    expect(aggregate(rows, { level: 'country', includeBundles: true })[0].nParties).toBe(6);
  });

  it('groups by city, merchant, continent and keeps yearly splits', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.01, city: 'Delhi', merchantKey: 'm1', eventYear: 2026 }),
      row({ partyId: 'B', usdPerCm2: 0.02, city: 'Pune', merchantKey: 'm1', eventYear: 2027 }),
      row({ partyId: 'C', usdPerCm2: 0.03, city: 'Pune', merchantKey: null, region: 'usa', country: 'United States' }),
    ];
    expect(aggregate(rows, { level: 'city' }).map((g) => g.label).sort()).toEqual(['Delhi, India', 'Pune, India', 'Pune, United States']);
    expect(aggregate(rows, { level: 'merchant' })).toHaveLength(1);
    expect(aggregate(rows, { level: 'continent' }).map((g) => g.key).sort()).toEqual(['Asia', 'North America']);
    const india = aggregate(rows, { level: 'country' }).find((g) => g.country === 'India')!;
    expect(Object.keys(india.yearly).sort()).toEqual(['2026', '2027']);
  });
});

describe('group keys and sort', () => {
  it('city groups expose plain city + country; cheapest sort orders by price', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.05, city: 'Pune' }), row({ partyId: 'B', usdPerCm2: 0.05, city: 'Pune' }),
      row({ partyId: 'C', usdPerCm2: 0.05, city: 'Pune' }), row({ partyId: 'D', usdPerCm2: 0.01, city: 'Delhi' }),
      row({ partyId: 'E', usdPerCm2: 0.01, city: 'Delhi' }),
    ];
    const g = aggregate(rows, { level: 'city', sort: 'cheapest' });
    expect(g[0].city).toBe('Delhi');
    expect(g[0].country).toBe('India');
    expect(g[0].key).toBe('delhi|India');
    expect(aggregate(rows, { level: 'city' })[0].city).toBe('Pune');
  });
});

describe('computeOutlierIds', () => {
  it('flags values outside the global band', () => {
    const f = computeOutlierIds([
      { id: 'lo', country: 'X', usdPerCm2: 0.0001 },
      { id: 'hi', country: 'X', usdPerCm2: 0.5 },
      { id: 'ok', country: 'X', usdPerCm2: 0.02 },
    ]);
    expect([...f].sort()).toEqual(['hi', 'lo']);
  });
  it('flags >3.5 modified-z from the country median (log scale) once n >= 5', () => {
    const rows = [0.018, 0.019, 0.02, 0.021, 0.022, 0.0205, 0.0195].map((v, i) => ({ id: `n${i}`, country: 'US', usdPerCm2: v }));
    rows.push({ id: 'bad', country: 'US', usdPerCm2: 0.15 });
    expect([...computeOutlierIds(rows)]).toEqual(['bad']);
  });
  it('does not apply MAD flagging to tiny samples', () => {
    const rows = [0.02, 0.021, 0.15].map((v, i) => ({ id: `n${i}`, country: 'US', usdPerCm2: v }));
    expect(computeOutlierIds(rows).size).toBe(0);
  });
});

describe('publicPartiesByCountry', () => {
  it('only returns parties behind published countries, using the public row rules', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.02 }),
      row({ partyId: 'B', usdPerCm2: 0.02, sizeConfidence: 0.5 }), // low confidence: not public
      row({ partyId: 'C', usdPerCm2: 0.02, country: 'Peru' }),
    ];
    const m = publicPartiesByCountry(rows, new Set(['India']));
    expect([...m.keys()]).toEqual(['India']);
    expect(m.get('India')).toEqual(['A']);
  });
});

describe('public index', () => {
  it('exposes aggregates only; single-event countries publish', () => {
    const rows = [
      ...['A', 'B', 'C'].map((p) => row({ partyId: p, usdPerCm2: 0.02 })),
      row({ partyId: 'D', usdPerCm2: 0.05, country: 'Peru', region: 'south-america' }),
    ];
    const pub = buildPublicIndexFromRows(rows);
    expect(pub.countries.map((c) => c.country)).toEqual(['India', 'Peru']);
    expect(pub.countries.every((c) => !c.estimated)).toBe(true);
    expect(pub.global.nCountries).toBe(2);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('Party A');
    expect(json).not.toContain('partyId');
    expect(json).not.toContain('merchant');
    expect(pub.countries[0].ladderUsd['30']).toBeGreaterThan(0);
    expect(pub.countries[0].countryCode).toBe('IN');
  });

  it('falls back to estimated sizes only for countries with no confirmed size', () => {
    const rows = [
      row({ partyId: 'A', usdPerCm2: 0.02 }),
      row({ partyId: 'B', usdPerCm2: 0.09, sizeConfidence: 0.5 }), // India has a confirmed size: estimate ignored
      row({ partyId: 'C', usdPerCm2: 0.03, country: 'Chile', region: 'south-america', sizeConfidence: 0.55 }),
      row({ partyId: 'D', usdPerCm2: 0.9, country: 'Chile', region: 'south-america', sizeConfidence: 0.55 }), // misread: outside band
      row({ partyId: 'E', usdPerCm2: 0.03, country: 'Togo', region: 'west-africa', sizeConfidence: 0.5, outlierFlag: true }),
    ];
    const pub = buildPublicIndexFromRows(rows);
    const india = pub.countries.find((c) => c.country === 'India')!;
    const chile = pub.countries.find((c) => c.country === 'Chile')!;
    expect(india.estimated).toBe(false);
    expect(india.usdPerCm2).toBeCloseTo(0.02, 6);
    expect(chile.estimated).toBe(true);
    expect(chile.nParties).toBe(1);
    expect(chile.usdPerCm2).toBeCloseTo(0.03, 6);
    expect(pub.countries.find((c) => c.country === 'Togo')).toBeUndefined(); // only an unverified outlier
  });
});
