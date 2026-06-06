import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { getUnderbossScope, partyMatchesScope, UnderbossScope } from './underbossScope.js';

/**
 * soppressata-50927 — GPP27 (Bitcoin Pizza Day 2027) helpers.
 *
 * The 2027 flow is admin/underboss-gated and reuses the existing `parties`
 * table. Two cross-cutting concerns live here:
 *   1. Year-aware slug resolution (`/{city}?year=YYYY`).
 *   2. The "is this viewer allowed to see a gated 2027 event" check used by the
 *      public resolver and the create endpoint.
 *
 * There is intentionally NO new `year` column — the event year is derived from
 * `parties.date` (`EXTRACT(YEAR FROM date)`).
 */

/** The launch year this flow mints events for. */
export const GPP27_YEAR = 2027;

/**
 * eventTags marker stamped on 2027 GPP parties so the public resolver can hide
 * them from anonymous/out-of-scope viewers until launch. Flip GPP27_PUBLIC to
 * true (or remove the gate) at launch.
 */
export const GPP27_TAG = 'gpp2027';

/**
 * Master kill-switch for pre-launch gating. While false, 2027 GPP events are
 * only visible to admins + the relevant underboss. Set the env var
 * GPP27_PUBLIC=true (or edit this default) to make 2027 events public at launch.
 */
export function isGpp27Public(): boolean {
  return process.env.GPP27_PUBLIC === 'true';
}

/**
 * Derive a normalized city slug from a raw URL slug, stripping a trailing
 * 2-digit year suffix when one is present and the remainder is non-empty.
 * e.g. `austin27` -> `austin`, `austin` -> `austin`, `27` -> `27`.
 */
export function citySlugFromSlug(slug: string): string {
  const s = slug.toLowerCase();
  const m = s.match(/^(.+?)(\d{2})$/);
  if (m && m[1].length > 0) return m[1];
  return s;
}

/**
 * Same normalization the create handlers use to turn a city name into a slug
 * (strip diacritics, lowercase, drop non-alphanumerics). Mirrors
 * gpp.routes.ts `slug` derivation.
 */
export function citySlugFromCityName(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface ResolvedYearMatch {
  id: string;
  inviteCode: string;
  customUrl: string | null;
  year: number;
  eventTags: string[];
  region: string | null;
  city: string | null;
}

/**
 * Year-aware resolution for GPP events.
 *
 * Given a public slug (already lowercased) and an optional `year`, find the GPP
 * party for that city + year. When `year` is null, pick the LATEST year for the
 * city (so a bare `/{city}` resolves to the most recent edition).
 *
 * Returns null when no GPP candidate matches — callers must then fall through
 * to the existing exact inviteCode/customUrl lookup so all current
 * (non-GPP and 2026) links keep working unchanged.
 */
export async function resolveGppByYear(
  slug: string,
  year: number | null,
): Promise<ResolvedYearMatch | null> {
  const citySlug = citySlugFromSlug(slug);

  // Candidate GPP parties for this city: customUrl is exactly the citySlug,
  // OR citySlug + a 2-digit year suffix (e.g. `austin` or `austin27`). We also
  // include the raw slug itself in case the caller passed `austin27` directly.
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    invite_code: string;
    custom_url: string | null;
    event_tags: string[];
    region: string | null;
    city: string | null;
    yr: number | null;
  }>>`
    SELECT id, invite_code, custom_url, event_tags, region, city,
           EXTRACT(YEAR FROM date)::int AS yr
    FROM parties
    WHERE event_type = 'gpp'
      AND date IS NOT NULL
      AND (
        custom_url = ${citySlug}
        OR custom_url ~ ${'^' + escapeRegex(citySlug) + '[0-9]{2}$'}
        OR custom_url = ${slug}
      )
  `;

  if (rows.length === 0) return null;

  let candidates = rows.filter((r) => r.yr != null);
  if (candidates.length === 0) return null;

  let chosen: typeof candidates[number] | undefined;
  if (year != null) {
    chosen = candidates.find((r) => r.yr === year);
  } else {
    // Latest-year wins.
    chosen = candidates.reduce((a, b) => ((b.yr as number) > (a.yr as number) ? b : a));
  }

  if (!chosen) return null;

  return {
    id: chosen.id,
    inviteCode: chosen.invite_code,
    customUrl: chosen.custom_url,
    year: chosen.yr as number,
    eventTags: chosen.event_tags || [],
    region: chosen.region,
    city: chosen.city,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is the given (already-resolved) event gated behind the GPP27 pre-launch wall
 * for this viewer? Returns true when the viewer should be treated as if the
 * event does not exist (404).
 *
 * A 2027 GPP event is gated when:
 *   - GPP27 is not yet public (isGpp27Public() === false), AND
 *   - the event carries the GPP27_TAG (or is dated 2027), AND
 *   - the viewer is neither an admin nor an underboss in scope for the event.
 */
export async function isGpp27Hidden(
  match: { year: number; eventTags: string[]; region: string | null; city: string | null },
  viewerEmail: string | null | undefined,
): Promise<boolean> {
  const isGpp27 = match.year === GPP27_YEAR || (match.eventTags || []).includes(GPP27_TAG);
  if (!isGpp27) return false;
  if (isGpp27Public()) return false;

  // Gated — only admins + in-scope underbosses may see it.
  const scope = await getUnderbossScope(viewerEmail);
  if (scope.isAdmin) return false;
  return !partyMatchesScope(
    { region: match.region, city: match.city, eventType: 'gpp' },
    scope,
  );
}

/**
 * Resolve the caller's underboss scope and assert they may act on the given
 * city/region (admin OR in-scope underboss). Throws when out of scope.
 */
export async function assertGpp27Authorized(
  viewerEmail: string | null | undefined,
  target: { region?: string | null; city?: string | null },
): Promise<UnderbossScope> {
  const scope = await getUnderbossScope(viewerEmail);
  if (scope.isAdmin) return scope;
  const ok = partyMatchesScope(
    { region: target.region ?? null, city: target.city ?? null, eventType: 'gpp' },
    scope,
  );
  if (!ok) {
    throw new AppError('You are not authorized to manage GPP27 events for this city.', 403, 'GPP27_FORBIDDEN');
  }
  return scope;
}

/**
 * City-tier reimbursement logic (marinara-71630 P5).
 *
 * The real tier-1/tier-2 city lists and the per-head rates / ceiling / formula
 * coefficient now live in `app_config` (keys `private.city_tiers` and
 * `private.reimbursement_tiers`), NOT in committed source. The helpers below
 * are PURE — they accept the resolved config as a parameter. The route layer
 * (`gpp27.routes.ts`) resolves config once at handler entry (60s-cached) and
 * passes it in, so behavior is identical to the old hardcoded values once the
 * matching config is seeded, and fail-safe ($0 / tier 3) when it isn't.
 */

/** Normalize + substring-match a city name against a list (drops spaces/hyphens). */
function matchesList(cityName: string, list: string[]): boolean {
  const normalized = cityName.toLowerCase().replace(/[-\s]/g, '');
  return list.some((c) => normalized.includes(c.replace(/[-\s]/g, '')));
}

/**
 * Resolve a city's tier from the configured tier-1/tier-2 lists. Anything not
 * matched (including an empty city or empty lists) is tier 3.
 */
export function cityTierFrom(
  cityName: string,
  tiers: { tier1: string[]; tier2: string[] },
): 1 | 2 | 3 {
  if (!cityName) return 3;
  if (matchesList(cityName, tiers.tier1)) return 1;
  if (matchesList(cityName, tiers.tier2)) return 2;
  return 3;
}

/**
 * Per-head USD rate for a tier from the configured rate table. A missing tier
 * key resolves to 0 (fail-safe — suggests nothing rather than over-suggesting).
 */
export function perHeadFrom(tier: 1 | 2 | 3, rates: Record<string, number>): number {
  const r = rates[String(tier)];
  return typeof r === 'number' && Number.isFinite(r) ? r : 0;
}

/**
 * Compute the suggested reimbursement cap for a city, clamped to the configured
 * ceiling. expectedAttendance = max(lastYearEstimatedAttendance, coefficient * rsvp).
 *
 * Pure: all tier/rate/ceiling/coefficient inputs come from `cfg` (resolved from
 * `app_config` at the route layer).
 */
export function computeReimbursementCap(
  args: {
    cityName: string;
    lastYearEstimatedAttendance: number | null;
    currentRsvpCount: number;
  },
  cfg: {
    tiers: { tier1: string[]; tier2: string[] };
    rates: Record<string, number>;
    ceilingUsd: number;
    coefficient: number;
  },
): {
  tier: 1 | 2 | 3;
  perHead: number;
  expectedAttendance: number;
  rawSuggested: number;
  cappedSuggested: number;
} {
  const tier = cityTierFrom(args.cityName, cfg.tiers);
  const perHead = perHeadFrom(tier, cfg.rates);
  const lastYear = args.lastYearEstimatedAttendance ?? 0;
  const fromRsvp = cfg.coefficient * (args.currentRsvpCount ?? 0);
  const expectedAttendance = Math.max(lastYear, fromRsvp);
  const rawSuggested = Math.round(perHead * expectedAttendance);
  const cappedSuggested = Math.min(rawSuggested, cfg.ceilingUsd);
  return { tier, perHead, expectedAttendance, rawSuggested, cappedSuggested };
}
