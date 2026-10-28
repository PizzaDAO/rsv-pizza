/**
 * sfincione-40417 (history): historical FX for archive receipts.
 *
 * getHistoricalUsdRate(currency, date) -> USD per 1 unit of `currency` on the
 * receipt date (official/interbank rate, NOT a parallel/"blue" rate). Order:
 *   0. manual override  (scripts/data/pizza-history-fx-overrides.json, "VES:2021-11" or "VES:2021-11-05")
 *   1. USD              -> 1 (usd-passthrough)
 *   2. Frankfurter/ECB  (~30 currencies; weekend -> prior business day)
 *   3. Yahoo daily close (keyless) for everything else
 * Otherwise it throws FxUnavailableError (the importer reports the receipt as failed).
 * It NEVER falls back to fx.service FALLBACK_RATES_TO_USD: those are 2026 numbers.
 *
 * fawazahmed0 dated snapshots (only from 2024-03-02) are a cross-check, not a source.
 * Lookups are cached in scripts/.cache/pizza-history-fx.json (gitignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HistoricalRate {
  /** USD per 1 unit of the currency. */
  rate: number;
  /** e.g. 'frankfurter:2022-05-20', 'yahoo:2022-05-20', 'manual:...', 'usd-passthrough'. */
  source: string;
  /** The date the rate is actually for (a weekend resolves to the prior business day). */
  date: string;
  /** Set when a cross-check disagreed by > 5%. */
  warning?: string;
}

export class FxUnavailableError extends Error {
  constructor(public currency: string, public date: string, detail = '') {
    super(`No historical USD rate for ${currency} on ${date}${detail ? ` (${detail})` : ''}`);
    this.name = 'FxUnavailableError';
  }
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface FxOptions {
  fetchImpl?: FetchLike;
  /** Overrides map; default: read scripts/data/pizza-history-fx-overrides.json. */
  overrides?: Record<string, { rate: number; source?: string }>;
  /** Cache file path; null disables caching (tests). */
  cachePath?: string | null;
  /** Also fetch the fawazahmed0 snapshot (>= 2024-03-02) and warn on a > 5% gap. */
  crossCheck?: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE = path.resolve(HERE, '../.cache/pizza-history-fx.json');
const DEFAULT_OVERRIDES = path.resolve(HERE, '../data/pizza-history-fx-overrides.json');
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FAWAZ_FROM = '2024-03-02';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function loadOverrides(file = DEFAULT_OVERRIDES): Record<string, { rate: number; source?: string }> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const memoryCache = new Map<string, HistoricalRate>();
let diskCache: Record<string, HistoricalRate> | null = null;

function readDisk(file: string): Record<string, HistoricalRate> {
  if (diskCache) return diskCache;
  try { diskCache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { diskCache = {}; }
  return diskCache!;
}
function writeDisk(file: string, key: string, v: HistoricalRate): void {
  const c = readDisk(file);
  c[key] = v;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(c, null, 1));
  } catch { /* cache is best effort */ }
}

/** Test helper: forget in-memory state. */
export function resetFxCaches(): void {
  memoryCache.clear();
  diskCache = null;
  yahooBlockedUntil = 0;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

async function frankfurter(cur: string, date: string, f: FetchLike): Promise<HistoricalRate | null> {
  try {
    const r = await f(`https://api.frankfurter.dev/v1/${date}?base=${cur}&symbols=USD`);
    if (!r.ok) return null;
    const j = await r.json();
    const rate = Number(j?.rates?.USD);
    if (!(rate > 0) || !Number.isFinite(rate)) return null;
    const d = typeof j?.date === 'string' && DATE_RE.test(j.date) ? j.date : date;
    return { rate, source: `frankfurter:${d}`, date: d };
  } catch {
    return null;
  }
}

let lastYahooAt = 0;
/** Circuit breaker: after a full round of 429s, skip Yahoo for a minute instead of stalling every receipt. */
let yahooBlockedUntil = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function yahoo(cur: string, date: string, f: FetchLike): Promise<HistoricalRate | null> {
  const end = Date.parse(`${date}T23:59:59Z`) / 1000;
  const start = end - 10 * 86400;
  if (Date.now() < yahooBlockedUntil) return null;
  // Unofficial endpoint: throttle, try both hosts, and back off on 429/5xx.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of ['query1', 'query2']) {
      const wait = lastYahooAt + 400 - Date.now();
      if (wait > 0) await sleep(wait);
      lastYahooAt = Date.now();
      try {
        const r = await f(
          `https://${host}.finance.yahoo.com/v8/finance/chart/${cur}=X?period1=${start}&period2=${end + 1}&interval=1d`,
          { headers: { 'User-Agent': BROWSER_UA } },
        );
        if (r.status === 429 || r.status >= 500) continue;
        if (!r.ok) return null;
        const j = await r.json();
        const res = j?.chart?.result?.[0];
        const ts: number[] = res?.timestamp ?? [];
        const close: Array<number | null> = res?.indicators?.quote?.[0]?.close ?? [];
        // last close on or before the date
        for (let i = Math.min(ts.length, close.length) - 1; i >= 0; i--) {
          const c = close[i];
          if (ts[i] <= end && typeof c === 'number' && c > 0 && Number.isFinite(c)) {
            const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
            return { rate: 1 / c, source: `yahoo:${d}`, date: d };
          }
        }
        return null;
      } catch {
        /* try the next host */
      }
    }
    await sleep(1500 * (attempt + 1));
  }
  yahooBlockedUntil = Date.now() + 60_000;
  return null;
}

async function fawaz(cur: string, date: string, f: FetchLike): Promise<number | null> {
  if (date < FAWAZ_FROM) return null;
  try {
    const lc = cur.toLowerCase();
    const r = await f(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${lc}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    const rate = Number(j?.[lc]?.usd);
    return rate > 0 && Number.isFinite(rate) ? rate : null;
  } catch {
    return null;
  }
}

function overrideFor(cur: string, date: string, ov: Record<string, { rate: number; source?: string }>): HistoricalRate | null {
  for (const key of [`${cur}:${date}`, `${cur}:${date.slice(0, 7)}`]) {
    const o = ov[key];
    if (o && o.rate > 0) return { rate: o.rate, source: `manual:${o.source ?? key}`, date };
  }
  return null;
}

export async function getHistoricalUsdRate(currencyIn: string, date: string, opts: FxOptions = {}): Promise<HistoricalRate> {
  const cur = currencyIn.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new FxUnavailableError(currencyIn, date, 'bad currency code');
  if (!DATE_RE.test(date)) throw new FxUnavailableError(cur, date, 'bad date');
  if (cur === 'USD') return { rate: 1, source: 'usd-passthrough', date };

  const ov = opts.overrides ?? loadOverrides();
  const manual = overrideFor(cur, date, ov);
  if (manual) return manual;

  const key = `${cur}:${date}`;
  const cachePath = opts.cachePath === undefined ? DEFAULT_CACHE : opts.cachePath;
  const hit = memoryCache.get(key) ?? (cachePath ? readDisk(cachePath)[key] : undefined);
  if (hit && !opts.fetchImpl) return hit;

  const f = opts.fetchImpl ?? defaultFetch;
  const found = (await frankfurter(cur, date, f)) ?? (await yahoo(cur, date, f));
  if (!found) throw new FxUnavailableError(cur, date, 'ECB and Yahoo both missed; add a manual override');

  if (opts.crossCheck) {
    const other = await fawaz(cur, date, f);
    if (other && Math.abs(other / found.rate - 1) > 0.05) {
      found.warning = `cross-check ${other.toFixed(6)} differs ${(Math.abs(other / found.rate - 1) * 100).toFixed(1)}% from ${found.rate.toFixed(6)}`;
    }
  }
  if (!opts.fetchImpl) {
    memoryCache.set(key, found);
    if (cachePath) writeDisk(cachePath, key, found);
  }
  return found;
}

/**
 * FX for a receipt: uses its date, or `${year}-10-01` (GPP's 10/10 window) tagged
 * `:assumed-date` when the transcription has none.
 */
export async function getReceiptFx(
  currency: string,
  receiptDate: string | null | undefined,
  year: number,
  opts: FxOptions = {},
): Promise<HistoricalRate & { assumedDate: boolean }> {
  const has = !!receiptDate && DATE_RE.test(receiptDate);
  const date = has ? receiptDate! : `${year}-10-01`;
  const r = await getHistoricalUsdRate(currency, date, opts);
  const assumedDate = !has;
  return { ...r, source: assumedDate && r.source !== 'usd-passthrough' ? `${r.source}:assumed-date` : r.source, assumedDate };
}
