/**
 * basil-14648 P2 (price priors): rsv's aggregated, PII-free price-priors export
 * for pizza-mcp (plans/rsv-p2-price-priors.md in openpizza; pizza-mcp docs/CLIENTS.md section 4).
 *
 * Input: Pizza Price Index rows (the `pizza_price_index_lines` view, via fetchIndexRows).
 * Output rows, strictly:
 *   {region, size_bucket, topping_count, currency, p50_cents, p80_cents, n, tax_included, as_of_year}
 * and nothing else: no party ids, names, merchants, receipt URLs, dates finer than a year, or host data.
 *
 * Rules:
 *   - window: event years >= current year - 1;
 *   - lines: the index's confirmed tier (selectRows: verified, or size confidence >= 0.8; no bundles,
 *     no lump sums, no unverified outliers), ROUND pies with a known diameter only;
 *   - size_bucket from the diameter in inches, pizza-mcp's sizeBucket thresholds (<=10 small, <=12 medium,
 *     <=14 large, else xl);
 *   - topping_count 0 (plain) or 2 (specialty), from pricePriors.classify;
 *   - each EVENT (IndexRow.eventKey) gives one value per (region, bucket, class): its qty-weighted median
 *     unit price; p50 / p80 are quantiles over events; n = distinct events;
 *   - a row is published only with n >= 3 events AND >= 2 distinct known merchants;
 *   - currency CAD (unit_price_list of CAD lines) for Canada, USD (unit_price_usd) everywhere else;
 *     tax_included false for US / CA (pre-tax receipts), true elsewhere (VAT-inclusive);
 *   - cents rounded to 25; rows that would break pizza-mcp's bounds are dropped (one bad row would make
 *     pizza-mcp reject the whole document).
 */
import { prisma } from '../config/database.js';
import { getCountryCode } from '../lib/countryCode.js';
import { regionKeys, subdivisionCode } from '../lib/regionKeys.js';
import { classifyPizzaName, type PriorClass } from './pricePriors.classify.js';
import {
  cached,
  communityIncluded,
  fetchIndexRows,
  quantile,
  selectRows,
  weightedMedian,
  type IndexRow,
} from './pizzaIndex.service.js';

export type SizeBucket = 'small' | 'medium' | 'large' | 'xl';

export interface PriorRow {
  region: string;
  size_bucket: SizeBucket;
  topping_count: PriorClass;
  currency: 'USD' | 'CAD';
  p50_cents: number;
  p80_cents: number;
  n: number;
  tax_included: boolean;
  as_of_year: number;
}

export interface PriceDocument {
  v: 1;
  generated_at: string;
  rows: PriorRow[];
}

/** The output keys, exactly (pizza-mcp's row schema is strict: any other key rejects the document). */
export const PRIOR_ROW_KEYS = [
  'region', 'size_bucket', 'topping_count', 'currency', 'p50_cents', 'p80_cents', 'n', 'tax_included', 'as_of_year',
] as const;

export const MIN_EVENTS = 3;
export const MIN_MERCHANTS = 2;
/** pizza-mcp validateBatch bounds. */
export const P50_BOUNDS = { min: 100, max: 10_000 } as const;
export const P80_MAX = 15_000;
export const MAX_ROWS = 2000;

/** pizza-mcp estimate.ts sizeBucket, from centimetres. */
export function sizeBucketFromCm(diameterCm: number): SizeBucket {
  const inches = diameterCm / 2.54;
  if (inches <= 10 + 1e-9) return 'small';
  if (inches <= 12 + 1e-9) return 'medium';
  if (inches <= 14 + 1e-9) return 'large';
  return 'xl';
}

export const roundTo25 = (cents: number): number => Math.round(cents / 25) * 25;

/** ISO2 from a stored party country (a name, or already a code). */
export function isoCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const t = country.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return getCountryCode(t);
}

const COUNTRY_TAIL = /^(usa|us|u\.s\.a?\.?|united states( of america)?|canada|ca)$/i;

/**
 * US / CA state code from a formatted address ("..., Boston, MA 02110, USA" or "..., Toronto, ON M5V 2T6,
 * Canada"). Used only to build the state key: the address itself never leaves this module.
 */
export function stateFromAddress(address: string | null | undefined, cc: string): string | null {
  if (!address || (cc !== 'US' && cc !== 'CA')) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length && COUNTRY_TAIL.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return null; // a bare city or street is not a state
  const last = parts[parts.length - 1]
    .replace(/\s+\d{5}(-\d{4})?$/, '') // US ZIP
    .replace(/\s+[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/, '') // CA postal code
    .trim();
  return subdivisionCode(cc, last);
}

interface Bucket {
  region: string;
  size_bucket: SizeBucket;
  topping_count: PriorClass;
  currency: 'USD' | 'CAD';
  tax_included: boolean;
  /** eventKey -> [unit price (major units), qty] */
  events: Map<string, Array<[number, number]>>;
  merchants: Set<string>;
  maxYear: number;
}

export interface BuildOptions {
  now?: Date;
  /** partyId -> state code (US / CA), from the party address. */
  states?: Map<string, string | null>;
}

/** Pure: index rows to the export document. */
export function buildPriceDocument(allRows: IndexRow[], opts: BuildOptions = {}): PriceDocument {
  const now = opts.now ?? new Date();
  const minYear = now.getUTCFullYear() - 1;
  const rows = selectRows(
    allRows.filter((r) => r.eventYear !== null && r.eventYear >= minYear),
    { verifiedOnly: false, includeBundles: false },
  );
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    if (r.shape !== 'round' || !r.diameterCm || !(r.diameterCm > 0)) continue;
    if (!(r.qty > 0)) continue;
    const cc = isoCountry(r.country);
    if (!cc) continue;
    let currency: 'USD' | 'CAD';
    let price: number;
    if (cc === 'CA') {
      if (r.currency !== 'CAD' || !(r.unitPriceList > 0)) continue;
      currency = 'CAD';
      price = r.unitPriceList;
    } else {
      if (!(r.unitPriceUsd > 0)) continue;
      currency = 'USD';
      price = r.unitPriceUsd;
    }
    const state = r.partyId ? opts.states?.get(r.partyId) ?? null : null;
    const keys = regionKeys({ country: cc, region: state, city: r.city });
    const size = sizeBucketFromCm(r.diameterCm);
    const cls = classifyPizzaName(r.rawName);
    for (const region of keys) {
      const k = `${region}|${size}|${cls}|${currency}`;
      let b = buckets.get(k);
      if (!b) {
        b = {
          region, size_bucket: size, topping_count: cls, currency,
          tax_included: !(cc === 'US' || cc === 'CA'),
          events: new Map(), merchants: new Set(), maxYear: r.eventYear!,
        };
        buckets.set(k, b);
      }
      const ev = b.events.get(r.eventKey) ?? [];
      ev.push([price, r.qty]);
      b.events.set(r.eventKey, ev);
      if (r.merchantKey) b.merchants.add(r.merchantKey);
      if (r.eventYear! > b.maxYear) b.maxYear = r.eventYear!;
    }
  }

  const out: PriorRow[] = [];
  for (const b of buckets.values()) {
    if (b.events.size < MIN_EVENTS || b.merchants.size < MIN_MERCHANTS) continue;
    const perEvent = [...b.events.values()]
      .map((pairs) => weightedMedian(pairs))
      .filter((v): v is number => v !== null);
    if (perEvent.length < MIN_EVENTS) continue;
    const p50 = roundTo25(quantile(perEvent, 0.5)! * 100);
    const p80 = Math.max(p50, roundTo25(quantile(perEvent, 0.8)! * 100));
    if (p50 < P50_BOUNDS.min || p50 > P50_BOUNDS.max || p80 > P80_MAX) continue;
    out.push({
      region: b.region,
      size_bucket: b.size_bucket,
      topping_count: b.topping_count,
      currency: b.currency,
      p50_cents: p50,
      p80_cents: p80,
      n: perEvent.length,
      tax_included: b.tax_included,
      as_of_year: b.maxYear,
    });
  }
  out.sort((a, b) =>
    a.region.localeCompare(b.region) ||
    a.size_bucket.localeCompare(b.size_bucket) ||
    a.topping_count - b.topping_count ||
    a.currency.localeCompare(b.currency));
  // Coarse keys first if we ever exceed the cap (country rows are the most useful).
  const capped = out.length > MAX_ROWS
    ? [...out].sort((a, b) => rank(a.region) - rank(b.region)).slice(0, MAX_ROWS)
    : out;
  return { v: 1, generated_at: now.toISOString(), rows: capped };
}

const rank = (region: string) => (region.startsWith('country:') ? 0 : region.startsWith('state:') ? 1 : 2);

/** partyId -> US / CA state code, read from the party address (never exported). */
async function loadStates(rows: IndexRow[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(rows
    .filter((r) => r.partyId && (isoCountry(r.country) === 'US' || isoCountry(r.country) === 'CA'))
    .map((r) => r.partyId!))];
  const states = new Map<string, string | null>();
  if (!ids.length) return states;
  const parties = await prisma.party.findMany({ where: { id: { in: ids } }, select: { id: true, address: true, country: true } });
  for (const p of parties) {
    const cc = isoCountry(p.country);
    states.set(p.id, cc ? stateFromAddress(p.address, cc) : null);
  }
  return states;
}

const PRIORS_TTL_MS = 60 * 60 * 1000;

/** The live document, cached 1 h (same TTL as the public index). */
export function getPriceDocument(): Promise<PriceDocument> {
  return cached('price-priors:v1', PRIORS_TTL_MS, async () => {
    let rows = await fetchIndexRows(undefined, {});
    // Same switch as the public index: community receipts can be pulled out without a deploy.
    if (!(await communityIncluded())) rows = rows.filter((r) => r.origin !== 'submission');
    const states = await loadStates(rows);
    return buildPriceDocument(rows, { states });
  });
}
