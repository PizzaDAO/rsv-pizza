/**
 * Private-config loader (marinara-71630 P0).
 *
 * The repo is going open-source, so private business config (payout caps,
 * reimbursement rules, fraud-detection weights, sponsors, scoring weights)
 * must NOT live in committed source. Instead, real values live ONLY in the
 * `app_config` DB table (Prisma model `AppConfig`), seeded to production
 * out-of-band. The fallbacks committed in this file are deliberately
 * NON-SENSITIVE placeholders that document the shape of each config.
 *
 * Notes / threat model:
 * - `app_config` keeps these values out of git; it is NOT a runtime secret
 *   store (it is plain DB rows readable by anything with DB access).
 * - Values that are truly secret (e.g. fraud-detection weights, which an
 *   attacker could game) are backend-only and MUST NEVER be shipped to the
 *   frontend bundle. Backend decides, frontend renders.
 * - Values are stored in the `value` column as JSON strings.
 *
 * This is Phase 0: infrastructure only, no consumers yet. Nothing reads from
 * this module — it exists so later phases can migrate hardcoded config here.
 */

import { prisma } from '../config/database.js';

/** Canonical `app_config` keys for each private-config domain. */
const KEYS = {
  reimbursementRules: 'private.reimbursement_rules',
  payoutCaps: 'private.payout_caps',
  fraudWeights: 'private.fraud_weights',
  sponsors: 'private.sponsors',
  scoringWeights: 'private.scoring_weights',
} as const;

// ---------------------------------------------------------------------------
// In-process cache (60s TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop a single key from the in-process cache. */
export function invalidate(key: string): void {
  cache.delete(key);
}

/** Drop the entire in-process cache. */
export function invalidateAll(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Read a private-config value from `app_config` by key.
 *
 * Returns the JSON-parsed `value`, or `fallback` on a cache/DB miss or a
 * JSON parse error. Never throws — config loading must never break a request.
 * Results are cached in-process for {@link CACHE_TTL_MS}.
 */
export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value as T;
  }

  let row: { value: string } | null = null;
  try {
    row = await prisma.appConfig.findUnique({ where: { key } });
  } catch (err) {
    console.warn(`[privateConfig] DB read failed for key "${key}"; using fallback.`, err);
    return fallback;
  }

  if (!row) {
    // Miss: cache the fallback so we don't hammer the DB for unseeded keys.
    cache.set(key, { value: fallback, expires: now + CACHE_TTL_MS });
    return fallback;
  }

  let parsed: T;
  try {
    parsed = JSON.parse(row.value) as T;
  } catch (err) {
    console.warn(`[privateConfig] JSON parse failed for key "${key}"; using fallback.`, err);
    return fallback;
  }

  cache.set(key, { value: parsed, expires: now + CACHE_TTL_MS });
  return parsed;
}

// ---------------------------------------------------------------------------
// Typed domain accessors
//
// Each accessor pairs a typed interface with a NON-SENSITIVE placeholder
// fallback. Real values are seeded to `app_config` in production.
// ---------------------------------------------------------------------------

export interface ReimbursementRules {
  methods: Array<{ id: string; label: string }>;
  countryRules: Array<{ match: { country?: string; tag?: string }; allow: string[] }>;
}

export function getReimbursementRules(): Promise<ReimbursementRules> {
  return getConfig<ReimbursementRules>(KEYS.reimbursementRules, {
    methods: [],
    countryRules: [],
  });
}

export interface PayoutCaps {
  perSubmissionMaxUsd: number;
  perAddressHardCapUsd: number;
  perTxCapUsd: number;
  dailyCapUsd: number;
  w9ThresholdUsd: number;
}

/**
 * Payout caps. Fallback is intentionally all-zero: a zero cap means
 * "config not seeded; treat as unconfigured". Consumers (later phases) MUST
 * treat 0 as unconfigured rather than as a literal $0 cap. The real
 * production caps are seeded to `app_config` and never committed here.
 */
export function getPayoutCaps(): Promise<PayoutCaps> {
  return getConfig<PayoutCaps>(KEYS.payoutCaps, {
    perSubmissionMaxUsd: 0,
    perAddressHardCapUsd: 0,
    perTxCapUsd: 0,
    dailyCapUsd: 0,
    w9ThresholdUsd: 0,
  });
}

export interface FraudWeights {
  weights: Record<string, number>;
  tiers: { high: number; medium: number; low: number };
}

/**
 * Fraud-detection weights. SECRET — backend-only, must never reach the
 * frontend bundle (an attacker who knows the weights can game the scorer).
 */
export function getFraudWeights(): Promise<FraudWeights> {
  return getConfig<FraudWeights>(KEYS.fraudWeights, {
    weights: {},
    tiers: { high: 0, medium: 0, low: 0 },
  });
}

export interface Sponsors {
  sponsors: Array<{ name: string; tier?: string; logoUrl?: string; url?: string }>;
}

export function getSponsors(): Promise<Sponsors> {
  return getConfig<Sponsors>(KEYS.sponsors, { sponsors: [] });
}

export interface ScoringWeights {
  leaderboard: Record<string, number>;
  pizzeria: Record<string, number>;
}

export function getScoringWeights(): Promise<ScoringWeights> {
  return getConfig<ScoringWeights>(KEYS.scoringWeights, {
    leaderboard: {},
    pizzeria: {},
  });
}

export { KEYS as PRIVATE_CONFIG_KEYS };
