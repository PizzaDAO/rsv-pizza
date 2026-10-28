/**
 * sfincione-40417 (Phase 2/3): Pizza Price Index aggregation.
 *
 * Observation unit: price per cm^2 of a pizza line (USD, local currency, and
 * net-of-discount USD). Aggregation (plan section 7 + decision 12):
 *   1. party value  = qty-weighted MEDIAN over that party's lines
 *   2. group value  = MEDIAN of party values   (one event = one vote)
 *   3. publish only with >= 3 parties (continent >= 10)
 * Every group also carries the price of a 25/30/35/40 cm pizza (decision 12.1).
 *
 * The aggregation functions are pure (unit tested); the SQL reads the
 * `pizza_price_index_lines` view.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { getCountryCode } from '../lib/countryCode.js';
import { STANDARD_SIZES_CM, roundArea } from './pizzaSize.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IndexLevel = 'global' | 'continent' | 'country' | 'city' | 'merchant';
export const INDEX_LEVELS: IndexLevel[] = ['global', 'continent', 'country', 'city', 'merchant'];

export interface IndexRow {
  lineId: string;
  documentId: string;
  partyId: string;
  partyName: string;
  country: string | null;
  city: string | null;
  region: string | null;
  eventYear: number | null;
  eventSeriesSlug: string | null;
  documentUrl: string | null;
  documentMimeType: string | null;
  sourceReceiptIndex: number | null;
  sourceReceiptCount: number | null;
  merchant: string | null;
  merchantKey: string | null;
  rawName: string;
  qty: number;
  currency: string;
  fxRate: number;
  unitPriceList: number;
  unitPriceNet: number | null;
  unitPriceUsd: number;
  unitPriceNetUsd: number | null;
  sizeLabel: string | null;
  shape: string | null;
  diameterCm: number | null;
  areaCm2: number;
  style: string | null;
  sizeSource: string | null;
  sizeConfidence: number | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  isVerified: boolean;
  outlierFlag: boolean;
  isBundle: boolean;
  usdPerCm2: number;
  localPerCm2: number;
  netUsdPerCm2: number | null;
}

export type SizeLadder = Record<'25' | '30' | '35' | '40', number | null>;

export interface Quantiles {
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface GroupSummary {
  nParties: number;
  nLines: number;
  /** Sum of qty. */
  nPizzas: number;
  nVerifiedLines: number;
  pctVerified: number;
  /** USD per cm^2 (list price): median of party medians + IQR across parties. */
  usdPerCm2: Quantiles;
  /** Net-of-discount USD per cm^2 (falls back to list when no discount). */
  netUsdPerCm2: number | null;
  /** Modal currency of the group's lines; local figures use only that currency. */
  localCurrency: string | null;
  localNParties: number;
  localPerCm2: number | null;
  /** Price of a 25/30/35/40 cm pizza = per-cm^2 median x area. */
  ladderUsd: SizeLadder;
  ladderLocal: SizeLadder;
  ladderNetUsd: SizeLadder;
}

export interface IndexGroup extends GroupSummary {
  level: IndexLevel;
  key: string;
  label: string;
  country: string | null;
  /** Plain city name (city level only). */
  city: string | null;
  continent: string | null;
  /** >= minParties distinct parties; unpublished groups are shown greyed. */
  published: boolean;
  minParties: number;
  yearly: Record<string, GroupSummary>;
}

export interface IndexOptions {
  level: IndexLevel;
  /** Only human-verified lines. Default: verified OR size_confidence >= 0.8. */
  verifiedOnly?: boolean;
  /** Include is_bundle lines in the medians. Default false. */
  includeBundles?: boolean;
  /** Drop groups below the publish threshold from the result. */
  publishedOnly?: boolean;
  /** 'parties' (default): most parties first. 'cheapest': lowest USD/cm^2 first. */
  sort?: 'parties' | 'cheapest';
  /** Rows were already filtered by the caller (public tiers); skip selectRows. */
  preselected?: boolean;
}

export const HIGH_CONFIDENCE = 0.8;
// Snax 2026-10-28: a country may publish from a single event (shown as "early" on the page).
export const MIN_PARTIES: Record<IndexLevel, number> = {
  global: 3, continent: 3, country: 1, city: 3, merchant: 3,
};

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Weighted median: smallest value whose cumulative weight reaches half the
 * total (lower weighted median; when exactly half, averages with the next).
 * Non-positive weights are ignored.
 */
export function weightedMedian(pairs: Array<[value: number, weight: number]>): number | null {
  const p = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  if (p.length === 0) return null;
  const total = p.reduce((a, [, w]) => a + w, 0);
  let cum = 0;
  for (let i = 0; i < p.length; i++) {
    cum += p[i][1];
    if (cum > total / 2 + 1e-9) return p[i][0];
    if (Math.abs(cum - total / 2) <= 1e-9) return i + 1 < p.length ? (p[i][0] + p[i + 1][0]) / 2 : p[i][0];
  }
  return p[p.length - 1][0];
}

const REGION_TO_CONTINENT: Record<string, string> = {
  usa: 'North America', canada: 'North America', 'central-america': 'North America',
  'south-america': 'South America',
  'western-europe': 'Europe', 'eastern-europe': 'Europe',
  'west-africa': 'Africa', 'east-africa': 'Africa', 'south-africa': 'Africa',
  india: 'Asia', asia: 'Asia', china: 'Asia', 'middle-east': 'Asia',
  oceania: 'Oceania',
};

export function regionToContinent(region: string | null | undefined): string | null {
  if (!region) return null;
  return REGION_TO_CONTINENT[region.trim().toLowerCase()] ?? null;
}

function ladder(perCm2: number | null): SizeLadder {
  const out = {} as SizeLadder;
  for (const d of STANDARD_SIZES_CM) {
    out[String(d) as keyof SizeLadder] = perCm2 === null ? null : Math.round(perCm2 * roundArea(d) * 10000) / 10000;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row selection + aggregation
// ---------------------------------------------------------------------------

/** Apply the index inclusion policy (plan section 7 + decisions 12.2/12.4). */
export function selectRows(rows: IndexRow[], opts: Pick<IndexOptions, 'verifiedOnly' | 'includeBundles'>): IndexRow[] {
  return rows.filter((r) => {
    if (!(r.areaCm2 > 0) || !(r.usdPerCm2 > 0)) return false;
    if (r.isBundle && !opts.includeBundles) return false;
    if (opts.verifiedOnly) return r.isVerified;
    if (r.isVerified) return true; // a human-verified outlier is real
    if (r.outlierFlag) return false; // unverified outliers go back to the queue
    return (r.sizeConfidence ?? 0) >= HIGH_CONFIDENCE;
  });
}

function modalCurrency(rows: IndexRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of counts) if (k > n) { best = c; n = k; }
  return best;
}

export function summarize(rows: IndexRow[]): GroupSummary {
  const byParty = new Map<string, IndexRow[]>();
  for (const r of rows) {
    const a = byParty.get(r.partyId) ?? [];
    a.push(r);
    byParty.set(r.partyId, a);
  }
  const currency = modalCurrency(rows);
  const partyUsd: number[] = [];
  const partyNet: number[] = [];
  const partyLocal: number[] = [];
  for (const prs of byParty.values()) {
    const usd = weightedMedian(prs.map((r) => [r.usdPerCm2, r.qty]));
    if (usd !== null) partyUsd.push(usd);
    const net = weightedMedian(prs.map((r) => [r.netUsdPerCm2 ?? r.usdPerCm2, r.qty]));
    if (net !== null) partyNet.push(net);
    if (currency) {
      const local = weightedMedian(prs.filter((r) => r.currency === currency).map((r) => [r.localPerCm2, r.qty]));
      if (local !== null) partyLocal.push(local);
    }
  }
  const usdMed = median(partyUsd);
  const netMed = median(partyNet);
  const localMed = median(partyLocal);
  const nVerified = rows.filter((r) => r.isVerified).length;
  return {
    nParties: byParty.size,
    nLines: rows.length,
    nPizzas: Math.round(rows.reduce((a, r) => a + r.qty, 0) * 100) / 100,
    nVerifiedLines: nVerified,
    pctVerified: rows.length ? Math.round((nVerified / rows.length) * 1000) / 10 : 0,
    usdPerCm2: { median: usdMed, p25: quantile(partyUsd, 0.25), p75: quantile(partyUsd, 0.75) },
    netUsdPerCm2: netMed,
    localCurrency: currency,
    localNParties: partyLocal.length,
    localPerCm2: localMed,
    ladderUsd: ladder(usdMed),
    ladderLocal: ladder(localMed),
    ladderNetUsd: ladder(netMed),
  };
}

interface GroupKey { key: string; label: string; country: string | null; continent: string | null; city?: string | null }

function groupKeyFor(level: IndexLevel, r: IndexRow): GroupKey | null {
  const continent = regionToContinent(r.region);
  switch (level) {
    case 'global':
      return { key: 'global', label: 'Global', country: null, continent: null };
    case 'continent':
      return { key: continent ?? 'Unknown', label: continent ?? 'Unknown', country: null, continent };
    case 'country':
      if (!r.country) return null;
      return { key: r.country, label: r.country, country: r.country, continent };
    case 'city':
      if (!r.city || !r.country) return null;
      return { key: `${r.city.trim().toLowerCase()}|${r.country}`, label: `${r.city.trim()}, ${r.country}`, country: r.country, continent, city: r.city.trim() };
    case 'merchant':
      if (!r.merchantKey) return null;
      return { key: r.merchantKey, label: r.merchant ?? r.merchantKey, country: r.country, continent };
  }
}

export function aggregate(allRows: IndexRow[], opts: IndexOptions): IndexGroup[] {
  const rows = opts.preselected ? allRows : selectRows(allRows, opts);
  const groups = new Map<string, { gk: GroupKey; rows: IndexRow[] }>();
  for (const r of rows) {
    const gk = groupKeyFor(opts.level, r);
    if (!gk) continue;
    const g = groups.get(gk.key) ?? { gk, rows: [] };
    g.rows.push(r);
    groups.set(gk.key, g);
  }
  const minParties = MIN_PARTIES[opts.level];
  const out: IndexGroup[] = [];
  for (const { gk, rows: grs } of groups.values()) {
    const summary = summarize(grs);
    const yearly: Record<string, GroupSummary> = {};
    const years = new Set(grs.map((r) => r.eventYear).filter((y): y is number => y !== null));
    for (const y of years) yearly[String(y)] = summarize(grs.filter((r) => r.eventYear === y));
    const published = summary.nParties >= minParties;
    if (opts.publishedOnly && !published) continue;
    // merchant groups can span countries; only keep a single country label if unique
    let country = gk.country;
    if (opts.level === 'merchant') {
      const cs = new Set(grs.map((r) => r.country));
      country = cs.size === 1 ? [...cs][0] : null;
    }
    out.push({ level: opts.level, ...gk, city: gk.city ?? null, country, ...summary, published, minParties, yearly });
  }
  if (opts.sort === 'cheapest') {
    out.sort((a, b) => (a.usdPerCm2.median ?? Infinity) - (b.usdPerCm2.median ?? Infinity) || a.label.localeCompare(b.label));
  } else {
    out.sort((a, b) => b.nParties - a.nParties || b.nLines - a.nLines || a.label.localeCompare(b.label));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------------

/** Sanity band for USD per cm^2 (plan section 7). */
export const OUTLIER_BAND = { min: 0.002, max: 0.2 } as const;
export const OUTLIER_MAD_THRESHOLD = 3.5;
const MIN_COUNTRY_SAMPLE = 5;

/**
 * Flag lines whose log(usd_per_cm2) is more than 3.5 modified-z (MAD-based,
 * 0.6745 * |x - median| / MAD) from their country median, or outside the
 * global sanity band. Countries with < 5 lines only get the band check.
 */
export function computeOutlierIds(
  rows: Array<{ id: string; country: string | null; usdPerCm2: number }>,
): Set<string> {
  const flagged = new Set<string>();
  const byCountry = new Map<string, Array<{ id: string; x: number }>>();
  for (const r of rows) {
    if (!(r.usdPerCm2 > 0)) continue;
    if (r.usdPerCm2 < OUTLIER_BAND.min || r.usdPerCm2 > OUTLIER_BAND.max) {
      flagged.add(r.id);
      continue;
    }
    if (!r.country) continue;
    const a = byCountry.get(r.country) ?? [];
    a.push({ id: r.id, x: Math.log(r.usdPerCm2) });
    byCountry.set(r.country, a);
  }
  for (const list of byCountry.values()) {
    if (list.length < MIN_COUNTRY_SAMPLE) continue;
    const med = median(list.map((l) => l.x))!;
    const mad = median(list.map((l) => Math.abs(l.x - med)))!;
    if (!(mad > 0)) continue;
    for (const l of list) {
      if ((0.6745 * Math.abs(l.x - med)) / mad > OUTLIER_MAD_THRESHOLD) flagged.add(l.id);
    }
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// SQL access
// ---------------------------------------------------------------------------

export interface IndexScope {
  /** true = unrestricted (admin / payment admin). */
  full: boolean;
  regions: string[];
  cities: string[];
}

export interface IndexFilters {
  country?: string | null;
  city?: string | null;
  continent?: string | null;
  merchantKey?: string | null;
  year?: number | null;
}

interface ViewRow {
  line_id: string; document_id: string; party_id: string; party_name: string;
  country: string | null; city: string | null; region: string | null;
  event_year: number | null; event_series_slug: string | null;
  document_url: string | null; document_mime_type: string | null;
  source_receipt_index: number | null; source_receipt_count: number | null;
  merchant: string | null; merchant_key: string | null; raw_name: string;
  qty: number; currency: string; fx_rate: number; unit_price_list: number; unit_price_net: number | null;
  unit_price_usd: number; unit_price_net_usd: number | null;
  size_label: string | null; shape: string | null; diameter_cm: number | null; area_cm2: number;
  style: string | null; size_source: string | null; size_confidence: number | null;
  verified_at: Date | null; verified_by: string | null; is_verified: boolean;
  outlier_flag: boolean; is_bundle: boolean;
  usd_per_cm2: number; local_per_cm2: number; net_usd_per_cm2: number | null;
}

function mapViewRow(v: ViewRow): IndexRow {
  return {
    lineId: v.line_id, documentId: v.document_id, partyId: v.party_id, partyName: v.party_name,
    country: v.country, city: v.city, region: v.region, eventYear: v.event_year,
    eventSeriesSlug: v.event_series_slug, documentUrl: v.document_url,
    documentMimeType: v.document_mime_type, sourceReceiptIndex: v.source_receipt_index,
    sourceReceiptCount: v.source_receipt_count, merchant: v.merchant, merchantKey: v.merchant_key,
    rawName: v.raw_name, qty: v.qty, currency: v.currency, fxRate: v.fx_rate,
    unitPriceList: v.unit_price_list, unitPriceNet: v.unit_price_net, unitPriceUsd: v.unit_price_usd,
    unitPriceNetUsd: v.unit_price_net_usd, sizeLabel: v.size_label, shape: v.shape,
    diameterCm: v.diameter_cm, areaCm2: v.area_cm2, style: v.style, sizeSource: v.size_source,
    sizeConfidence: v.size_confidence, verifiedAt: v.verified_at, verifiedBy: v.verified_by,
    isVerified: v.is_verified, outlierFlag: v.outlier_flag, isBundle: v.is_bundle,
    usdPerCm2: v.usd_per_cm2, localPerCm2: v.local_per_cm2, netUsdPerCm2: v.net_usd_per_cm2,
  };
}

/** SQL predicate restricting parties (alias `p`) to an underboss scope. */
export function scopeSql(scope: IndexScope | undefined, alias = 'p'): Prisma.Sql {
  if (!scope || scope.full) return Prisma.empty;
  const a = Prisma.raw(alias);
  const regions = scope.regions;
  const cities = scope.cities.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (regions.length === 0 && cities.length === 0) return Prisma.sql`AND false`;
  return Prisma.sql`AND (${a}.region = ANY(${regions}::text[]) OR lower(trim(${a}.city)) = ANY(${cities}::text[]))`;
}

export async function fetchIndexRows(scope?: IndexScope, f: IndexFilters = {}): Promise<IndexRow[]> {
  const cond: Prisma.Sql[] = [];
  if (f.country) cond.push(Prisma.sql`AND v.country = ${f.country}`);
  if (f.city) cond.push(Prisma.sql`AND lower(trim(v.city)) = ${f.city.trim().toLowerCase()}`);
  if (f.merchantKey) cond.push(Prisma.sql`AND v.merchant_key = ${f.merchantKey}`);
  if (f.year) cond.push(Prisma.sql`AND v.event_year = ${f.year}`);
  const scopeCond = scope && !scope.full ? scopeSql(scope, 'v') : Prisma.empty;
  const rows = await prisma.$queryRaw<ViewRow[]>(Prisma.sql`
    SELECT v.* FROM pizza_price_index_lines v
    WHERE true ${cond.length ? Prisma.join(cond, ' ') : Prisma.empty} ${scopeCond}`);
  let mapped = rows.map(mapViewRow);
  if (f.continent) mapped = mapped.filter((r) => regionToContinent(r.region) === f.continent);
  return mapped;
}

/**
 * Recompute outlier_flag for every line in the index view (non-bundles) and
 * persist the diff. Returns the number of flagged lines. Cheap: < 5k rows.
 */
export async function flagOutliers(): Promise<{ flagged: number; changed: number }> {
  const rows = await prisma.$queryRaw<Array<{ line_id: string; country: string | null; usd_per_cm2: number }>>(Prisma.sql`
    SELECT line_id, country, usd_per_cm2 FROM pizza_price_index_lines WHERE is_bundle = false`);
  const flagged = computeOutlierIds(rows.map((r) => ({ id: r.line_id, country: r.country, usdPerCm2: r.usd_per_cm2 })));
  const ids = [...flagged];
  const on = await prisma.$executeRaw`
    UPDATE pizza_line_items SET outlier_flag = true, updated_at = now()
    WHERE id = ANY(${ids}::uuid[]) AND outlier_flag = false`;
  const off = await prisma.$executeRaw`
    UPDATE pizza_line_items SET outlier_flag = false, updated_at = now()
    WHERE outlier_flag = true AND NOT (id = ANY(${ids}::uuid[]))`;
  return { flagged: ids.length, changed: Number(on) + Number(off) };
}

let lastOutlierRun = 0;
/** Refresh outlier flags at most once per `minGapMs` (edits make them stale). */
export async function refreshOutliers(minGapMs = 30_000): Promise<void> {
  if (Date.now() - lastOutlierRun < minGapMs) return;
  lastOutlierRun = Date.now();
  await flagOutliers();
}

// ---------------------------------------------------------------------------
// Cache (5 min, invalidated on any write)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

export function invalidatePizzaIndexCache(): void {
  cache.clear();
  publicCache = null;
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function cachedIndex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return cached(key, CACHE_TTL_MS, fn);
}

// ---------------------------------------------------------------------------
// Public (Phase 3): aggregates only
// ---------------------------------------------------------------------------

/** Public page launches with GPP 2026 data (decision 12.6). */
export const PUBLIC_INDEX_YEAR = 2026;
const PUBLIC_TTL_MS = 60 * 60 * 1000;

export interface PublicCountryEntry {
  country: string;
  countryCode: string | null;
  continent: string | null;
  nParties: number;
  nLines: number;
  nPizzas: number;
  usdPerCm2: number;
  /** Price of a 25/30/35/40 cm pizza in USD. */
  ladderUsd: SizeLadder;
  localCurrency: string | null;
  localPerCm2: number | null;
  ladderLocal: SizeLadder;
  /** true when no size in this country is confirmed yet and the figure uses estimated sizes. */
  estimated: boolean;
}

export interface PublicPizzaIndex {
  year: number;
  generatedAt: string;
  minParties: number;
  basis: string;
  global: { nParties: number; nCountries: number; usdPerCm2: number | null; ladderUsd: SizeLadder };
  countries: PublicCountryEntry[];
}

/** Estimated-tier rows outside this USD/cm^2 band are treated as misreads (wrong currency, totals as unit prices). */
export const ESTIMATE_SANE_USD_PER_CM2 = { min: 0.002, max: 0.2 } as const;

/**
 * Rows behind the public figures (Snax 2026-10-28: show every country we have).
 * A country with any confirmed size (verified or >= 0.8) uses only those rows.
 * A country with none falls back to estimated sizes (any confidence), minus
 * unverified outliers and anything outside the sanity band, and is flagged.
 */
export function selectPublicRows(rows: IndexRow[]): { rows: IndexRow[]; estimatedCountries: Set<string> } {
  const confirmed = selectRows(rows, { verifiedOnly: false, includeBundles: false });
  const confirmedCountries = new Set(confirmed.map((r) => r.country).filter((c): c is string => !!c));
  const estimated = rows.filter((r) =>
    r.country && !confirmedCountries.has(r.country) &&
    r.areaCm2 > 0 && r.usdPerCm2 > 0 && !r.isBundle && !r.outlierFlag &&
    r.usdPerCm2 >= ESTIMATE_SANE_USD_PER_CM2.min && r.usdPerCm2 <= ESTIMATE_SANE_USD_PER_CM2.max);
  return {
    rows: [...confirmed, ...estimated],
    estimatedCountries: new Set(estimated.map((r) => r.country!)),
  };
}

export function buildPublicIndexFromRows(allRows: IndexRow[]): PublicPizzaIndex {
  const { rows, estimatedCountries } = selectPublicRows(allRows);
  const countries = aggregate(rows, { level: 'country', includeBundles: false, publishedOnly: true, preselected: true })
    .filter((g) => g.usdPerCm2.median !== null && g.country)
    .map<PublicCountryEntry>((g) => ({
      country: g.country!,
      countryCode: getCountryCode(g.country),
      continent: g.continent,
      nParties: g.nParties,
      nLines: g.nLines,
      nPizzas: g.nPizzas,
      usdPerCm2: g.usdPerCm2.median!,
      ladderUsd: g.ladderUsd,
      localCurrency: g.localCurrency,
      localPerCm2: g.localPerCm2,
      ladderLocal: g.ladderLocal,
      estimated: estimatedCountries.has(g.country!),
    }))
    .sort((a, b) => a.usdPerCm2 - b.usdPerCm2);
  // Global figure only over published countries so unpublished data never leaks in.
  const publishedNames = new Set(countries.map((c) => c.country));
  const g = summarize(rows.filter((r) => r.country && publishedNames.has(r.country)));
  return {
    year: PUBLIC_INDEX_YEAR,
    generatedAt: new Date().toISOString(),
    minParties: MIN_PARTIES.country,
    basis: 'median of per-event medians; menu (list) prices; confirmed sizes where a country has any, otherwise estimated sizes (flagged); bundles excluded',
    global: { nParties: g.nParties, nCountries: countries.length, usdPerCm2: g.usdPerCm2.median, ladderUsd: g.ladderUsd },
    countries,
  };
}

/** Party ids behind each PUBLISHED country's figure (server-side only; never serialized). */
export function publicPartiesByCountry(rows: IndexRow[], published: Set<string>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const r of selectPublicRows(rows).rows) {
    if (!r.country || !published.has(r.country)) continue;
    (out.get(r.country) ?? out.set(r.country, new Set()).get(r.country)!).add(r.partyId);
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

let publicCache: { at: number; value: PublicPizzaIndex; parties: Map<string, string[]> } | null = null;

async function loadPublic() {
  if (publicCache && Date.now() - publicCache.at < PUBLIC_TTL_MS) return publicCache;
  const rows = await fetchIndexRows(undefined, { year: PUBLIC_INDEX_YEAR });
  const value = buildPublicIndexFromRows(rows);
  const parties = publicPartiesByCountry(rows, new Set(value.countries.map((c) => c.country)));
  publicCache = { at: Date.now(), value, parties };
  return publicCache;
}

export async function getPublicPizzaIndex(): Promise<PublicPizzaIndex> {
  return (await loadPublic()).value;
}

export interface PublicCountryPhoto {
  url: string;
  thumbnailUrl: string | null;
  city: string | null;
}

export const PUBLIC_PHOTOS_PER_COUNTRY = 12;

/**
 * Pizza photos from the events behind a published country's figure, for the
 * public page's country drill-down. Same visibility rules as the public photo
 * feed (approved, not deleted, event photos public + enabled, event approved).
 * Payout "pizza" photos first, then pizza-captioned/tagged, starred, most voted;
 * at most 3 per event so one party can't fill the strip. null = not published.
 */
export async function getPublicCountryPhotos(country: string): Promise<PublicCountryPhoto[] | null> {
  const { parties } = await loadPublic();
  const ids = parties.get(country);
  if (!ids?.length) return null;
  return cached(`public-photos:${country}`, PUBLIC_TTL_MS, async () => {
    const rows = await prisma.$queryRaw<Array<{ url: string; thumbnail_url: string | null; city: string | null }>>(Prisma.sql`
      SELECT url, thumbnail_url, city FROM (
        SELECT ph.url, ph.thumbnail_url, pa.city, ph.party_id,
          (ph.payout_role = 'pizza') AS is_pizza_role,
          (coalesce(ph.caption, '') ILIKE '%pizza%' OR 'pizza' = ANY(ph.tags)) AS is_pizza_tag,
          ph.starred, ph.vote_count, ph.created_at,
          row_number() OVER (
            PARTITION BY ph.party_id
            ORDER BY (ph.payout_role = 'pizza') DESC NULLS LAST,
                     (coalesce(ph.caption, '') ILIKE '%pizza%' OR 'pizza' = ANY(ph.tags)) DESC,
                     ph.starred DESC, ph.vote_count DESC, ph.created_at
          ) AS rn
        FROM photos ph JOIN parties pa ON pa.id = ph.party_id
        WHERE ph.party_id = ANY(${ids}::uuid[])
          AND ph.status = 'approved' AND ph.deleted_at IS NULL
          AND ph.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          AND pa.underboss_status = 'approved' AND pa.photos_public = true AND pa.photos_enabled = true
      ) x
      WHERE rn <= 3
      ORDER BY rn, is_pizza_role DESC NULLS LAST, is_pizza_tag DESC, starred DESC, vote_count DESC, party_id
      LIMIT ${PUBLIC_PHOTOS_PER_COUNTRY}`);
    return rows.map((r) => ({ url: r.url, thumbnailUrl: r.thumbnail_url, city: r.city }));
  });
}
