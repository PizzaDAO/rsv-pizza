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
  cityTiers: 'private.city_tiers',
  reimbursementTiers: 'private.reimbursement_tiers',
  reimbursementCapBands: 'private.reimbursement_cap_bands',
  sponsorshipPricing: 'private.sponsorship_pricing',
  gppGlobalEditors: 'private.gpp_global_editors',
  swcHubRules: 'private.swc_hub_rules',
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

/**
 * One configurable reimbursement option.
 *
 * `kind: 'method'` options (e.g. usdc_base / mercury_card / wire) are real,
 * selectable payout methods the host can pick and submit receipts against.
 * `kind: 'external'` options (e.g. an SWC-hub informational card) are NOT
 * selectable payout methods — the frontend renders them as informational
 * cards (optionally with a link via `url`) and must never set `method` to
 * their id.
 */
export interface ReimbursementOption {
  id: string;
  label: string;
  description?: string;
  kind: 'method' | 'external';
  url?: string;
}

/**
 * A country/tag-scoped override of the visible/enabled options.
 *
 * Matches a party when `party.country === match.country` OR `match.tag` is
 * present in `party.eventTags`.
 *  - `visible` (if set) restricts the shown options to exactly these ids
 *    (preserving `methods[]` order) — e.g. US → `['swc_hub']`.
 *  - `disable` marks shown-but-disabled options with a reason (e.g.
 *    mercury_card in Mercury-blocked countries).
 */
export interface CountryRule {
  match: { country?: string; tag?: string };
  visible?: string[];
  disable?: Array<{ id: string; reason: string }>;
}

export interface ReimbursementRules {
  methods: ReimbursementOption[];
  default: string[];
  countryRules: CountryRule[];
}

export function getReimbursementRules(): Promise<ReimbursementRules> {
  return getConfig<ReimbursementRules>(KEYS.reimbursementRules, {
    methods: [],
    default: [],
    countryRules: [],
  });
}

export interface PayoutCaps {
  perSubmissionMaxUsd: number;
  perAddressHardCapUsd: number;
  perTxCapUsd: number;
  dailyCapUsd: number;
  w9ThresholdUsd: number;
  hardPerTxCeilingUsd: number;
}

/**
 * Payout money caps (marinara-71630 P2). The real production caps live ONLY in
 * `app_config` (key `private.payout_caps`) and are seeded out-of-band — they
 * are NEVER committed to this repo.
 *
 * Fallback = FAIL-SAFE LOW placeholders, deliberately NOT the real values and
 * NOT zero. If this fallback ever fires (DB miss / unseeded key / parse error),
 * payouts cap LOW (safe) rather than over-pay: every enforcement path rejects
 * amounts ABOVE these floors, so the worst case is "legitimate payouts are
 * blocked until config is seeded", never "an over-payment slips through". The
 * numbers are kept coherent (ceiling / per-address ≥ per-tx / per-submission)
 * so the ordering invariants the consumers rely on still hold.
 */
export function getPayoutCaps(): Promise<PayoutCaps> {
  return getConfig<PayoutCaps>(KEYS.payoutCaps, {
    perSubmissionMaxUsd: 100,
    perAddressHardCapUsd: 110,
    perTxCapUsd: 100,
    dailyCapUsd: 100,
    w9ThresholdUsd: 100,
    hardPerTxCeilingUsd: 100,
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

// ---------------------------------------------------------------------------
// City tiers + GPP27 reimbursement + sponsorship pricing (marinara-71630 P5)
//
// These three keys move the city-tier lists, the GPP27 per-head
// reimbursement rates/ceiling/formula, and the sponsorship pricing tiers out
// of committed source (backend/src/helpers/gpp27.ts and the frontend
// sponsorshipPricing util) and into `app_config`. Real values are seeded to
// prod out-of-band; the fallbacks below are non-sensitive and chosen so an
// unseeded config is SAFE rather than wrong.
// ---------------------------------------------------------------------------

export interface CityTiers {
  tier1: string[];
  tier2: string[];
}

/**
 * Tier-1/tier-2 city name lists (everything not matched is tier 3). Real lists
 * are seeded to `app_config`.
 *
 * Fallback = empty lists. With no tier-1/tier-2 entries every city resolves to
 * tier 3, which is the safe default: tier 3 carries the LOWEST per-head
 * reimbursement rate and the most conservative sponsorship pricing band, so an
 * unseeded config never over-suggests a payout or an inflated sponsorship.
 */
export function getCityTiers(): Promise<CityTiers> {
  return getConfig<CityTiers>(KEYS.cityTiers, { tier1: [], tier2: [] });
}

export interface ReimbursementTiers {
  /** Per-head USD reimbursement rate keyed by tier ('1' | '2' | '3'). */
  perHeadRates: Record<string, number>;
  /** Absolute per-event reimbursement ceiling (USD) the suggestion clamps to. */
  ceilingUsd: number;
  /** Coefficient applied to the current RSVP count in the attendance estimate. */
  attendanceRsvpCoefficient: number;
}

/**
 * GPP27 reimbursement rules: per-head rates by tier, the per-event ceiling, and
 * the RSVP coefficient used in expectedAttendance = max(lastYear, coeff*rsvp).
 * Real values are seeded to `app_config`.
 *
 * Fallback = all zeros (rates `{1:0,2:0,3:0}`, ceiling 0, coefficient 0). This
 * is FAIL-SAFE: an unseeded config suggests a $0 cap (and the ceiling clamps to
 * $0) rather than over-suggesting a reimbursement. The worst case is "the
 * budget tool suggests $0 until config is seeded", never an over-payment.
 */
export function getReimbursementTiers(): Promise<ReimbursementTiers> {
  return getConfig<ReimbursementTiers>(KEYS.reimbursementTiers, {
    perHeadRates: { '1': 0, '2': 0, '3': 0 },
    ceilingUsd: 0,
    attendanceRsvpCoefficient: 0,
  });
}

export interface ReimbursementCapBand {
  /** Floor expected-guests count — anything ≤ this gets the floor amount. */
  guestFloor: number;
  /** Ceiling expected-guests count — anything ≥ this gets the max amount. */
  guestCeiling: number;
  /** Minimum suggested cap (at or below guestFloor). */
  minUsd: number;
  /** Maximum suggested cap (at or above guestCeiling). */
  maxUsd: number;
}

export interface ReimbursementCapBands {
  /** Per-tier dollar band keyed by tier ('1' | '2' | '3'). */
  bands: Record<string, ReimbursementCapBand>;
  /** Round the interpolated suggestion to the nearest this-many USD. */
  roundingIncrementUsd: number;
}

/**
 * Underboss "suggested reimbursement cap" bands (the heuristic shown in
 * ReimbursementCapCell). For each tier the suggestion linearly interpolates a
 * dollar amount between `minUsd` (at `guestFloor` expected guests) and `maxUsd`
 * (at `guestCeiling`), then rounds to `roundingIncrementUsd`. These per-tier
 * dollar bands are the ORIGINAL arugula-38633 band math (distinct from the
 * GPP27 per-head reimbursement formula); the real numbers are seeded to
 * `app_config` and are NOT committed.
 *
 * Fallback = empty `bands` + `roundingIncrementUsd: 25`. With no band for the
 * resolved tier the frontend util returns NO suggestion (suggestedUsd: null) —
 * a safe "cap config unavailable" state rather than a bogus $0 cap. The
 * rounding increment is kept non-zero (and equal to the original 25) so the
 * util never divides by zero even on an unseeded config.
 */
export function getReimbursementCapBands(): Promise<ReimbursementCapBands> {
  return getConfig<ReimbursementCapBands>(KEYS.reimbursementCapBands, {
    bands: {},
    roundingIncrementUsd: 25,
  });
}

export interface SponsorshipPricing {
  /** Per-tier pricing band keyed by tier ('1' | '2' | '3'). */
  tierConfig: Record<string, { floor: number; ceiling: number; max: number }>;
  /** Base price (USD) every event starts from. */
  base: number;
  /** Round the computed price to the nearest this-many USD. */
  roundTo: number;
}

/**
 * Sponsorship pricing tiers consumed by the (future) frontend pricing util and
 * surfaced via GET /api/config/pricing. Real values are seeded to `app_config`.
 *
 * Fallback = empty tierConfig + base 0 + roundTo 50. `roundTo` is deliberately
 * NON-ZERO even in the fallback: the downstream price formula divides by
 * `roundTo`, so a zero here would produce NaN/Infinity. An empty `tierConfig`
 * means a price can't be computed for any tier until config is seeded (the
 * consumer treats a missing tier as "no suggestion"), which is the safe default.
 */
export function getSponsorshipPricing(): Promise<SponsorshipPricing> {
  return getConfig<SponsorshipPricing>(KEYS.sponsorshipPricing, {
    tierConfig: {},
    base: 0,
    roundTo: 50,
  });
}

// ---------------------------------------------------------------------------
// GPP global-editor allowlist (marinara-71630 P6)
//
// Emails that automatically get editor access to ALL GPP events. These users
// don't appear in any party's co_hosts array, so they're invisible in host
// settings and on the public event page — granting cross-event edit rights.
// Moved out of committed source (was a hardcoded const in
// backend/src/helpers/partyAccess.ts). Real list is seeded to `app_config`
// (key `private.gpp_global_editors`) out-of-band; NOT committed.
// ---------------------------------------------------------------------------

/**
 * Emails granted invisible editor access to every GPP event.
 *
 * Fallback = EMPTY list. This is FAIL-SAFE: an unseeded config grants no one
 * global-editor rights, so the worst case is "a global editor temporarily
 * can't edit until config is seeded" — never "an extra account silently gains
 * cross-event edit access". Normal access checks (owner, co-host, scoped
 * underboss, admin) are unaffected by this list and still apply.
 *
 * The consuming access checks compare emails case-INSENSITIVELY (both sides
 * lowercased), preserving the original `partyAccess.ts` semantics; this
 * accessor returns the list verbatim and leaves casing to the caller.
 */
export function getGppGlobalEditors(): Promise<string[]> {
  return getConfig<string[]>(KEYS.gppGlobalEditors, []);
}

// ---------------------------------------------------------------------------
// SWC-hub party rules (marinara-71630 P7)
//
// Which parties are SWC-hub-routed (reimbursement handled through SWC, not
// rsv.pizza) used to be hardcoded in the OPEN frontend (`frontend/src/utils/
// swcHub.ts`): country === 'United States', the 'SWC Hub' event tag, and a
// 'nonhub' exclusion tag. Those business literals move here, into `app_config`
// (key `private.swc_hub_rules`), out of the open-source bundle. The non-secret
// MATCHING logic stays in `swcHub.ts`; this just supplies the data.
// ---------------------------------------------------------------------------

export interface SwcHubRules {
  /** Country names that flag a party as SWC-hub (matched per swcHub.ts). */
  countries: string[];
  /** Event tags that flag a party as SWC-hub. */
  tags: string[];
  /** Event tags that force a party OUT of the SWC-hub gate (takes precedence). */
  excludeTags: string[];
}

/**
 * SWC-hub party matching rules consumed by the payments-admin SWC warning.
 *
 * Fallback = EMPTY lists (`{ countries: [], tags: [], excludeTags: [] }`). This
 * is FAIL-SAFE: with no rules NOTHING is flagged SWC-hub, so the worst case is
 * "the SWC admin warning doesn't appear until config is seeded" — the SWC
 * warning is a frontend-only admin ACK (not an enforcement gate), so an
 * unseeded config simply means the soft warning doesn't block a send, never an
 * over-broad block. Real values are seeded to `app_config` out-of-band.
 */
export function getSwcHubRules(): Promise<SwcHubRules> {
  return getConfig<SwcHubRules>(KEYS.swcHubRules, {
    countries: [],
    tags: [],
    excludeTags: [],
  });
}

export { KEYS as PRIVATE_CONFIG_KEYS };
