/**
 * Per-request / per-party site brand (white-label). See plans/whitelabel-team1-monad.md §1.
 *
 * A branded EventSeries (site_url set, active) gets its own origin + display name in
 * user-facing links and email chrome. Anything else resolves to the CALLER'S existing
 * fallback URL plus the deploy-level brand, so unbranded output is byte-identical.
 */
import { prisma } from '../config/database.js';
import { brand } from '../config/brand.js';

export interface SiteBrand {
  /** Canonical origin, no trailing slash. */
  url: string;
  /** Display name for email chrome. */
  name: string;
  /** Resend `from` header. */
  fromEmail: string;
}

interface SeriesSite {
  id: string;
  slug: string;
  url: string;
  name: string;
}

interface SiteCache {
  at: number;
  byId: Map<string, SeriesSite>;
  byOrigin: Map<string, SeriesSite>;
}

const CACHE_TTL_MS = 60_000;

let cache: SiteCache | null = null;
let inflight: Promise<SiteCache> | null = null;

/** Normalize an origin/URL for exact comparison: trim, drop trailing slashes, lowercase. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().replace(/\/+$/, '').toLowerCase();
  return v || null;
}

async function load(): Promise<SiteCache> {
  const rows = await prisma.eventSeries.findMany({
    where: { siteUrl: { not: null }, isActive: true },
    select: { id: true, slug: true, siteUrl: true, brandName: true, displayName: true, name: true },
  });
  const byId = new Map<string, SeriesSite>();
  const byOrigin = new Map<string, SeriesSite>();
  for (const r of rows) {
    const origin = normalizeOrigin(r.siteUrl);
    if (!origin) continue;
    const site: SeriesSite = {
      id: r.id,
      slug: r.slug,
      url: (r.siteUrl as string).trim().replace(/\/+$/, ''),
      name: (r.brandName && r.brandName.trim()) || r.displayName || r.name,
    };
    byId.set(r.id, site);
    byOrigin.set(origin, site);
  }
  return { at: Date.now(), byId, byOrigin };
}

/** Active series that have a site_url, cached 60 s. Never throws: on DB error returns the stale/empty cache. */
export async function getSeriesSites(): Promise<SiteCache> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (!inflight) {
    inflight = load()
      .then((c) => {
        cache = c;
        return c;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    console.error('siteBrand: failed to load series sites, using fallback', err);
    return cache ?? { at: 0, byId: new Map(), byOrigin: new Map() };
  }
}

/** Test helper. */
export function _resetSiteBrandCache(): void {
  cache = null;
  inflight = null;
}

function fallbackSite(fallbackUrl: string): SiteBrand {
  return { url: fallbackUrl, name: brand.name, fromEmail: brand.fromEmail };
}

function brandedSite(s: SeriesSite): SiteBrand {
  return { url: s.url, name: s.name, fromEmail: `${s.name} <${brand.noreplyEmail}>` };
}

/** Site for a party. No series / unbranded series -> the call site's own fallback, unchanged. */
export async function siteForParty(
  party: { eventSeriesId?: string | null } | null | undefined,
  fallbackUrl: string,
): Promise<SiteBrand> {
  const id = party?.eventSeriesId;
  if (!id) return fallbackSite(fallbackUrl);
  const { byId } = await getSeriesSites();
  const s = byId.get(id);
  return s ? brandedSite(s) : fallbackSite(fallbackUrl);
}

/** The party's branded site, or null when it has no series / the series isn't a live branded site. */
export async function brandedSiteForParty(
  party: { eventSeriesId?: string | null } | null | undefined,
): Promise<SiteBrand | null> {
  const id = party?.eventSeriesId;
  if (!id) return null;
  const { byId } = await getSeriesSites();
  const s = byId.get(id);
  return s ? brandedSite(s) : null;
}

/** Site for a request Origin. Exact match against registered site_urls only; anything else falls back. */
export async function siteForOrigin(origin: string | null | undefined, fallbackUrl: string): Promise<SiteBrand> {
  const o = normalizeOrigin(origin);
  if (!o) return fallbackSite(fallbackUrl);
  const { byOrigin } = await getSeriesSites();
  const s = byOrigin.get(o);
  return s ? brandedSite(s) : fallbackSite(fallbackUrl);
}

/** Series fields the create route needs (stamping + the optional create-flow preset). */
export interface BrandedSeries {
  id: string;
  publicTags?: string[];
  slug?: string;
  displayName?: string;
  brandName?: string | null;
  createFlow?: string | null;
  nameTemplate?: string | null;
  requireApproval?: boolean;
  hideGuests?: boolean;
  photosEnabled?: boolean;
  photosPublic?: boolean;
  ogImageUrl?: string | null;
  description?: string | null;
  flyerTemplateKey?: string | null;
  eventDate?: Date | null;
  eventStartTime?: string | null;
  eventEndTime?: string | null;
}

/** Active series with a site_url, by slug (for party-creation stamping). Null otherwise. */
export async function brandedSeriesBySlug(slug: unknown): Promise<BrandedSeries | null> {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  const s = await prisma.eventSeries.findFirst({
    where: { slug: slug.trim(), isActive: true, siteUrl: { not: null } },
    select: {
      id: true, publicTags: true, slug: true, displayName: true, brandName: true,
      createFlow: true, nameTemplate: true, requireApproval: true, hideGuests: true,
      photosEnabled: true, photosPublic: true, ogImageUrl: true, description: true,
      flyerTemplateKey: true, eventDate: true, eventStartTime: true, eventEndTime: true,
    },
  });
  return s ?? null;
}
