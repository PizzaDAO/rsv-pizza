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
  /**
   * Set only for a series sending from its own verified domain (`fromEmail` is then the partner
   * address). `fallbackFrom` is the default sender used if Resend rejects the partner domain.
   * Unbranded and not-yet-verified sites leave these unset, so their shape is unchanged.
   */
  fallbackFrom?: string;
  seriesId?: string;
  /** `email_reply_to`; sent as the Resend `reply_to` (also before domain verification). */
  replyTo?: string;
}

interface SeriesSite {
  id: string;
  slug: string;
  url: string;
  name: string;
  /** Extra origins (old host after a cutover, or a staged new domain); resolve to this site. */
  aliases: string[];
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  emailDomain: string | null;
  emailDomainVerifiedAt: Date | null;
  /** Public brand-config columns (served by /api/brand-config; see lib/brandConfig.ts). */
  config: SeriesBrandRow;
}

/** The public brand columns of an active branded series (never any email/domain/wallet/tag field). */
export interface SeriesBrandRow {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  brandName: string | null;
  siteUrl: string | null;
  tagline: string | null;
  metaDescription: string | null;
  supportEmail: string | null;
  logoUrl: string | null;
  logoLightUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  themeClass: string | null;
  themeTokens: unknown;
  flyerTemplateKey: string | null;
  flyerArt: unknown;
  configVersion: number;
}

interface SiteCache {
  at: number;
  byId: Map<string, SeriesSite>;
  byOrigin: Map<string, SeriesSite>;
}

const CACHE_TTL_MS = 60_000;

let cache: SiteCache | null = null;
let inflight: Promise<SiteCache> | null = null;
/** Bumped by every invalidation so a load that started earlier can't overwrite fresher state. */
let generation = 0;

/** Normalize an origin/URL for exact comparison: trim, drop trailing slashes, lowercase. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().replace(/\/+$/, '').toLowerCase();
  return v || null;
}

async function load(): Promise<SiteCache> {
  const rows = await prisma.eventSeries.findMany({
    where: { siteUrl: { not: null }, isActive: true },
    select: {
      id: true, slug: true, siteUrl: true, brandName: true, displayName: true, name: true,
      siteAliases: true, emailFromAddress: true, emailFromName: true, emailReplyTo: true,
      emailDomain: true, emailDomainVerifiedAt: true,
      tagline: true, metaDescription: true, supportEmail: true, logoUrl: true, logoLightUrl: true,
      faviconUrl: true, ogImageUrl: true, themeClass: true, themeTokens: true, flyerTemplateKey: true,
      flyerArt: true, configVersion: true,
    },
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
      aliases: Array.isArray(r.siteAliases) ? r.siteAliases : [],
      emailFromAddress: r.emailFromAddress ?? null,
      emailFromName: r.emailFromName ?? null,
      emailReplyTo: r.emailReplyTo ?? null,
      emailDomain: r.emailDomain ?? null,
      emailDomainVerifiedAt: r.emailDomainVerifiedAt ?? null,
      config: {
        id: r.id, slug: r.slug, name: r.name, displayName: r.displayName, brandName: r.brandName ?? null,
        siteUrl: r.siteUrl ?? null, tagline: r.tagline ?? null, metaDescription: r.metaDescription ?? null,
        supportEmail: r.supportEmail ?? null, logoUrl: r.logoUrl ?? null, logoLightUrl: r.logoLightUrl ?? null,
        faviconUrl: r.faviconUrl ?? null, ogImageUrl: r.ogImageUrl ?? null, themeClass: r.themeClass ?? null,
        themeTokens: r.themeTokens ?? null, flyerTemplateKey: r.flyerTemplateKey ?? null,
        flyerArt: r.flyerArt ?? null, configVersion: r.configVersion ?? 1,
      },
    };
    byId.set(r.id, site);
    byOrigin.set(origin, site);
  }
  // Aliases resolve to the canonical site, but never shadow another series' own site_url.
  for (const site of byId.values()) {
    for (const alias of site.aliases) {
      const a = normalizeOrigin(alias);
      if (a && !byOrigin.has(a)) byOrigin.set(a, site);
    }
  }
  return { at: Date.now(), byId, byOrigin };
}

/** Active series that have a site_url, cached 60 s. Never throws: on DB error returns the stale/empty cache. */
export async function getSeriesSites(): Promise<SiteCache> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (!inflight) {
    const myGen = generation;
    const p: Promise<SiteCache> = load()
      .then((c) => {
        // A load that began before an invalidation may hold pre-change data: don't store it.
        if (myGen === generation) cache = c;
        return c;
      })
      .finally(() => {
        // Only clear our own slot, never a newer in-flight load started after an invalidation.
        if (inflight === p) inflight = null;
      });
    inflight = p;
  }
  try {
    return await inflight;
  } catch (err) {
    console.error('siteBrand: failed to load series sites, using fallback', err);
    return cache ?? { at: 0, byId: new Map(), byOrigin: new Map() };
  }
}

/** An exact https origin: no path, no userinfo, lowercase host, optional port. */
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/**
 * Origins CORS should trust for white-label sites: the `site_url` and `site_aliases` of ACTIVE series
 * (same 60 s cache as everything here; on a DB error that is the stale or empty cache, so callers
 * fall back to the env list). Only exact https origins qualify, so a bad row can never add an
 * `http://`, a path, or a wildcard.
 */
export async function getSeriesOrigins(): Promise<Set<string>> {
  const { byOrigin } = await getSeriesSites();
  const out = new Set<string>();
  for (const o of byOrigin.keys()) if (HTTPS_ORIGIN.test(o)) out.add(o);
  return out;
}

/**
 * The public brand row for a request host (site_url or alias, active series only) or a series slug.
 * `degraded` is true when the series cache is empty because the DB load failed (callers answer 503
 * instead of a cacheable 404). Reads only the 60 s cache above: no per-request DB query.
 */
export async function brandRowFor(
  q: { host?: string | null; slug?: string | null },
): Promise<{ row: SeriesBrandRow | null; degraded: boolean }> {
  const { at, byId, byOrigin } = await getSeriesSites();
  const degraded = at === 0 && byId.size === 0;
  let site: SeriesSite | undefined;
  if (q.slug) {
    const slug = q.slug.trim().toLowerCase();
    for (const s of byId.values()) if (s.slug.toLowerCase() === slug) { site = s; break; }
  } else if (q.host) {
    const o = normalizeOrigin(`https://${q.host}`);
    if (o) site = byOrigin.get(o);
  }
  return { row: site ? site.config : null, degraded };
}

/** Drop the cached series sites so the next lookup reloads (used after a sender revert). */
export function invalidateSiteBrandCache(): void {
  generation++;
  // Expire, don't discard: if the reload fails, getSeriesSites still falls back to this stale copy.
  if (cache) cache = { ...cache, at: 0 };
  inflight = null;
}

/** Test helper. */
export function _resetSiteBrandCache(): void {
  generation++;
  cache = null;
  inflight = null;
}

function fallbackSite(fallbackUrl: string): SiteBrand {
  return { url: fallbackUrl, name: brand.name, fromEmail: brand.fromEmail };
}

/**
 * Strip every RFC 5322 special and control char from a From display name (same rule as the admin
 * validator, `senderNameOrNull`): no quoting, so `Acme, Inc` and `support@paypal.com` can't add
 * recipients or spoof an address.
 */
function headerName(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f"<>,;:@()[\]\\]/g, '').replace(/\s+/g, ' ').trim();
}

/** True when the address' domain equals `domain` or is a subdomain of it. */
function addressUnder(address: string, domain: string): boolean {
  const host = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/**
 * Sender for a series. The partner address is used only when ALL hold: from-address set, the domain
 * verified (server-written timestamp), and the address on the Resend sending domain. Anything else
 * is today's exact "<name> <brand noreply>", so existing brands are byte-identical.
 * `reply_to` applies even before verification.
 */
function brandedSite(s: SeriesSite): SiteBrand {
  const fallbackFrom = `${s.name} <${brand.noreplyEmail}>`;
  const site: SiteBrand = { url: s.url, name: s.name, fromEmail: fallbackFrom };
  if (s.emailReplyTo) site.replyTo = s.emailReplyTo;
  if (s.emailFromAddress && s.emailDomainVerifiedAt && s.emailDomain && addressUnder(s.emailFromAddress, s.emailDomain)) {
    const display = headerName(s.emailFromName || '') || s.name;
    site.fromEmail = `${display} <${s.emailFromAddress}>`;
    site.fallbackFrom = fallbackFrom;
    site.seriesId = s.id;
  }
  return site;
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

/** The live branded series whose site origin exactly matches this Origin header, or null. */
export async function seriesSlugForOrigin(origin: string | null | undefined): Promise<string | null> {
  const o = normalizeOrigin(origin);
  if (!o) return null;
  const { byOrigin } = await getSeriesSites();
  return byOrigin.get(o)?.slug ?? null;
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
