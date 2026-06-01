// scamorza-71819: shared data-gathering for the partner Consolidated Report.
//
// Extracted from `GET /api/sponsor/report` so the same payload can be served
// by the read-only public `/api/sponsor/report/ai/:token` endpoint that powers
// the "Share with AI" link without duplicating any of the aggregation logic.
//
// All field selection, masking and exclusions from the existing /report
// handler are preserved verbatim — raw guest emails are NEVER returned, and
// notable-attendee emails are always reduced to `@domain` before they leave
// this function.

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { buildIndustryOrgs } from './emailDomains.js';

// pecorino-64118: maps a partner tag to ITS OWN newsletter opt-in column on the
// Guest model. The consolidated report's "newsletter signups" tile counts only
// these (never PizzaDAO's mailingListOptIn) and is hidden for any other tag.
export const NEWSLETTER_OPTIN_FIELD: Record<
  string,
  'swcOptIn' | 'swcCaOptIn' | 'swcAuOptIn' | 'swcEuOptIn' | 'swcUkOptIn' | 'swcBrOptIn' | 'ethconfOptIn'
> = {
  swc: 'swcOptIn',
  swccanada: 'swcCaOptIn',
  swcau: 'swcAuOptIn',
  swceu: 'swcEuOptIn',
  swcuk: 'swcUkOptIn',
  swcbr: 'swcBrOptIn',
  ethconf: 'ethconfOptIn',
};

export interface ConsolidatedReportEventRow {
  id: string;
  name: string;
  date: Date | null;
  slug: string | null;
  city: string | null;
  country: string | null;
  reportSlug: string | null;
  rsvpCount: number;
  approvedCount: number;
  impressions: { totalViews: number; uniqueVisitors: number };
  clicks: number;
  industryOrgs: { domain: string; count: number }[];
}

export interface ConsolidatedReportJSON {
  partnerName: string | null;
  tag: string | null;
  isAdmin: boolean;
  approvedOnly: boolean;
  eventCount: number;
  dateRange: { start: string; end: string } | null;
  stats: {
    totalRsvps: number;
    approvedGuests: number;
    mailingListSignups: number | null;
    walletAddresses: number;
    poapMints: number;
    poapMoments: number;
    socialPostViews: number;
    socialPostCount: number;
  };
  impressions: { totalViews: number; uniqueVisitors: number };
  clickStats: {
    totalClicks: number;
    uniqueClickers: number;
    byLink: {
      url: string;
      linkType: string;
      linkLabel: string | null;
      clicks: number;
      uniqueClickers: number;
    }[];
  };
  notableAttendees: any[];
  industryOrgs: { domain: string; count: number }[];
  socialPosts: any[];
  featuredPhotos: any[];
  walletAddressList: string[];
  events: ConsolidatedReportEventRow[];
}

export interface BuildConsolidatedReportOpts {
  tag: string | null | undefined;
  isAdminViewing: boolean;
  sponsorUser?: { id: string; name?: string | null } | null;
  approvedOnly?: boolean;
}

// Empty payload used when the caller has no resolvable tag and isn't an
// admin (defense in depth — shouldn't happen in practice).
function emptyReport(): ConsolidatedReportJSON {
  return {
    partnerName: null,
    tag: null,
    isAdmin: false,
    approvedOnly: true,
    eventCount: 0,
    dateRange: null,
    stats: {
      totalRsvps: 0,
      approvedGuests: 0,
      mailingListSignups: null,
      walletAddresses: 0,
      poapMints: 0,
      poapMoments: 0,
      socialPostViews: 0,
      socialPostCount: 0,
    },
    impressions: { totalViews: 0, uniqueVisitors: 0 },
    clickStats: { totalClicks: 0, uniqueClickers: 0, byLink: [] },
    notableAttendees: [],
    industryOrgs: [],
    socialPosts: [],
    featuredPhotos: [],
    walletAddressList: [],
    events: [],
  };
}

export async function buildConsolidatedReport(
  opts: BuildConsolidatedReportOpts
): Promise<ConsolidatedReportJSON> {
  const tag = opts.tag?.trim().toLowerCase() || undefined;
  const isAdminViewing = !!opts.isAdminViewing;
  const approvedOnlyParam = !!opts.approvedOnly;

  // pecorino-64118: newsletter signups count THIS tag's own opt-in column, if any.
  const optinField = tag ? NEWSLETTER_OPTIN_FIELD[tag] : undefined;

  // Build where clause — identical to GET /events
  const where: any = {};
  if (tag && tag !== 'pizzadao') {
    where.eventTags = { has: tag };
  } else if (tag === 'pizzadao') {
    where.eventType = 'gpp';
  } else if (isAdminViewing) {
    where.eventType = 'gpp';
    where.NOT = { eventTags: { equals: [] } };
  }

  // Non-admin partners only see approved events.
  if (!isAdminViewing) {
    where.underbossStatus = 'approved';
  } else if (approvedOnlyParam) {
    // Admin opted in to approved-only via the toggle.
    where.underbossStatus = 'approved';
  }
  // Exclude cancelled events (consistent with GET /events).
  where.cancelledAt = null;

  // Non-admin with no resolvable tag (shouldn't happen): early-return empty.
  if (!tag && !isAdminViewing) {
    return emptyReport();
  }

  // Load all matching parties with report-relevant includes (mirrors report.routes.ts GET).
  const parties = await prisma.party.findMany({
    where,
    include: {
      socialPosts: { orderBy: { sortOrder: 'asc' } },
      notableAttendees: {
        orderBy: { sortOrder: 'asc' },
        include: { guest: { select: { email: true } } },
      },
      photos: {
        where: { status: 'approved' },
        orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      },
      user: { select: { name: true, profilePictureUrl: true } },
      guests: {
        select: {
          id: true,
          email: true,
          mailingListOptIn: true,
          swcOptIn: true,
          swcCaOptIn: true,
          swcAuOptIn: true,
          swcEuOptIn: true,
          swcUkOptIn: true,
          swcBrOptIn: true,
          ethconfOptIn: true,
          ethereumAddress: true,
          approved: true,
          status: true,
        },
      },
    },
    orderBy: { date: 'asc' },
  });

  const eventIds = parties.map(p => p.id);

  // pecorino-64118: collect approved guest emails across ALL loaded events for
  // one combined Industry RSVPs rollup (org domains only, personal providers
  // excluded). Raw emails are never returned — only { domain, count }.
  const industryOrgEmails: (string | null | undefined)[] = [];

  // Aggregate per-event stats + the rollup.
  let totalRsvps = 0;
  let approvedGuests = 0;
  let mailingListSignups = 0;
  let walletAddresses = 0;
  let poapMints = 0;
  let poapMoments = 0;
  let socialPostViews = 0;
  let socialPostCount = 0;

  const walletSet = new Set<string>();
  const combinedSocialPosts: any[] = [];
  const combinedNotable: any[] = [];
  const combinedPhotos: any[] = [];

  // Page-view (impression) aggregation — total + TRUE cross-event distinct visitors.
  const viewStats = eventIds.length > 0
    ? await prisma.pageView.groupBy({
        by: ['partyId'],
        where: { partyId: { in: eventIds } },
        _count: true,
      })
    : [];
  const viewCountMap = new Map(viewStats.map(r => [r.partyId, r._count]));
  let totalViews = 0;
  for (const v of viewStats) totalViews += v._count;

  let uniqueVisitors = 0;
  if (eventIds.length > 0) {
    const uniqRows = await prisma.$queryRaw<{ unique_count: bigint }[]>`
      SELECT COUNT(DISTINCT visitor_hash) AS unique_count
      FROM page_views
      WHERE party_id::text IN (${Prisma.join(eventIds)})
        AND visitor_hash IS NOT NULL
    `;
    uniqueVisitors = Number(uniqRows[0]?.unique_count || 0);
  }

  // Per-event unique visitors (for the per-event table rows).
  const perEventUniqueViewMap = new Map<string, number>();
  if (eventIds.length > 0) {
    const perEventUniq = await prisma.$queryRaw<{ party_id: string; unique_count: bigint }[]>`
      SELECT party_id::text, COUNT(DISTINCT visitor_hash) AS unique_count
      FROM page_views
      WHERE party_id::text IN (${Prisma.join(eventIds)})
      GROUP BY party_id
    `;
    for (const r of perEventUniq) perEventUniqueViewMap.set(r.party_id, Number(r.unique_count));
  }

  // Determine partner names to filter link clicks by (same logic as GET /events).
  let partnerNames: string[] = [];
  if (!isAdminViewing && opts.sponsorUser) {
    const partnerRecord = await prisma.sponsorUser.findUnique({
      where: { id: opts.sponsorUser.id },
      select: { coHostName: true, name: true, email: true },
    });
    const displayName =
      partnerRecord?.coHostName || partnerRecord?.name || partnerRecord?.email || '';
    if (displayName) partnerNames = [displayName];
  } else if (isAdminViewing) {
    const tagPartners = await prisma.sponsorUser.findMany({
      where: { ...(tag ? { tag } : {}), isActive: true },
      select: { coHostName: true, name: true, email: true },
    });
    partnerNames = tagPartners
      .map(p => p.coHostName || p.name || p.email)
      .filter(Boolean) as string[];
  }

  let labelFilter = Prisma.empty;
  if (partnerNames.length === 1) {
    labelFilter = Prisma.sql`AND (link_label = ${partnerNames[0]} OR link_label LIKE ${partnerNames[0] + '_%'})`;
  } else if (partnerNames.length > 1) {
    const conditions = partnerNames.map(n =>
      Prisma.sql`link_label = ${n} OR link_label LIKE ${n + '_%'}`
    );
    labelFilter = Prisma.sql`AND (${Prisma.join(conditions, ' OR ')})`;
  }

  // Link-click aggregation: per-link rollup + per-event totals.
  const clicksByLink = eventIds.length > 0
    ? await prisma.$queryRaw<{ party_id: string; url: string; link_type: string; link_label: string | null; total_clicks: bigint; unique_clicks: bigint }[]>`
      SELECT
        party_id::text,
        url,
        link_type,
        MAX(link_label) as link_label,
        COUNT(*) as total_clicks,
        COUNT(DISTINCT visitor_hash) as unique_clicks
      FROM link_clicks
      WHERE party_id::text IN (${Prisma.join(eventIds)})
      AND link_type IN ('sponsor', 'host_social')
      ${labelFilter}
      GROUP BY party_id, url, link_type
      ORDER BY total_clicks DESC
    `
    : [];

  const perEventClickCount = new Map<string, number>();
  const byLinkAgg = new Map<string, { url: string; linkType: string; linkLabel: string | null; clicks: number; uniqueClickers: number }>();
  let totalClicks = 0;
  for (const row of clicksByLink) {
    perEventClickCount.set(row.party_id, (perEventClickCount.get(row.party_id) || 0) + Number(row.total_clicks));
    totalClicks += Number(row.total_clicks);
    const key = `${row.link_type}::${row.url}`;
    const existing = byLinkAgg.get(key);
    if (existing) {
      existing.clicks += Number(row.total_clicks);
      existing.uniqueClickers += Number(row.unique_clicks);
    } else {
      byLinkAgg.set(key, {
        url: row.url,
        linkType: row.link_type,
        linkLabel: row.link_label,
        clicks: Number(row.total_clicks),
        uniqueClickers: Number(row.unique_clicks),
      });
    }
  }
  const byLink = Array.from(byLinkAgg.values()).sort((a, b) => b.clicks - a.clicks);

  // TRUE cross-event distinct clickers (don't sum per-event uniques).
  let uniqueClickers = 0;
  if (eventIds.length > 0) {
    const labelFilterClause = labelFilter === Prisma.empty ? Prisma.empty : labelFilter;
    const uniqClickRows = await prisma.$queryRaw<{ unique_count: bigint }[]>`
      SELECT COUNT(DISTINCT visitor_hash) AS unique_count
      FROM link_clicks
      WHERE party_id::text IN (${Prisma.join(eventIds)})
        AND link_type IN ('sponsor', 'host_social')
        AND visitor_hash IS NOT NULL
        ${labelFilterClause}
    `;
    uniqueClickers = Number(uniqClickRows[0]?.unique_count || 0);
  }

  // Per-event rows + scalar rollups from the loaded parties.
  const events: ConsolidatedReportEventRow[] = parties.map(party => {
    const submitted = party.guests.filter(g => g.status !== 'INVITED');
    const rsvpCount = submitted.length;
    const approvedCount = submitted.filter(g => g.approved !== false).length;
    totalRsvps += rsvpCount;
    approvedGuests += approvedCount;
    if (optinField) {
      mailingListSignups += submitted.filter(
        g => g.approved !== false && (g as any)[optinField] === true
      ).length;
    }

    for (const g of submitted) {
      if (g.approved !== false) industryOrgEmails.push(g.email);
    }

    for (const g of submitted) {
      if (g.ethereumAddress) {
        walletAddresses += 1;
        walletSet.add(g.ethereumAddress);
      }
    }

    poapMints += party.poapMints || 0;
    poapMoments += party.poapMoments || 0;

    const partyContext = {
      slug: party.customUrl || party.inviteCode,
      name: party.name,
      city: party.city,
      country: party.country,
    };

    socialPostCount += party.socialPosts.length;
    for (const sp of party.socialPosts) {
      socialPostViews += sp.views || 0;
      combinedSocialPosts.push({ ...sp, eventName: party.name, party: partyContext });
    }

    // Notable attendees — mask email to @domain (mirrors published public report).
    for (const a of party.notableAttendees) {
      const { guest, ...attendee } = a as any;
      const fullEmail = guest?.email as string | undefined;
      const domain = fullEmail?.split('@')[1] || null;
      combinedNotable.push({
        ...attendee,
        email: domain ? `@${domain}` : null,
        eventName: party.name,
      });
    }

    for (const ph of party.photos) {
      combinedPhotos.push({ ...ph, party: partyContext });
    }

    // pecorino-64118: per-event Industry RSVPs — org domains from THIS event's
    // approved guests, so the consolidated report can group industry orgs by city.
    const eventIndustryOrgs = buildIndustryOrgs(
      submitted.filter(g => g.approved !== false).map(g => g.email)
    );

    const reportSlug = party.reportPublicSlug || party.customUrl || party.inviteCode;
    return {
      id: party.id,
      name: party.name,
      date: party.date,
      slug: party.customUrl || party.inviteCode,
      city: party.city,
      country: party.country,
      reportSlug,
      rsvpCount,
      approvedCount,
      impressions: {
        totalViews: viewCountMap.get(party.id) || 0,
        uniqueVisitors: perEventUniqueViewMap.get(party.id) || 0,
      },
      clicks: perEventClickCount.get(party.id) || 0,
      industryOrgs: eventIndustryOrgs,
    };
  });

  // pecorino-64118: report shows a representative SAMPLE (starred/best first,
  // then recent); the "View all photos" link covers the rest via /photos.
  const featuredPhotos = combinedPhotos.slice(0, 24);

  // Deduped wallet address list.
  const walletAddressList = Array.from(walletSet);

  // Date range.
  const dates = parties
    .map(p => p.date)
    .filter((d): d is Date => !!d)
    .map(d => new Date(d).getTime());
  const dateRange = dates.length > 0
    ? { start: new Date(Math.min(...dates)).toISOString(), end: new Date(Math.max(...dates)).toISOString() }
    : null;

  // pecorino-64118: combined Industry RSVPs across all events.
  const industryOrgs = buildIndustryOrgs(industryOrgEmails);

  // pecorino-64118 follow-up: header shows the ORG name for the filtered tag
  // (sponsor_users.coHostName), not the logged-in user's personal name.
  let partnerName: string | null = null;
  if (tag) {
    const tagSponsors = await prisma.sponsorUser.findMany({
      where: { tag, isActive: true },
      select: { coHostName: true },
    });
    const orgName = tagSponsors
      .map(s => s.coHostName?.trim())
      .find((v): v is string => !!v);
    partnerName = orgName || (tag === 'pizzadao' ? 'PizzaDAO' : tag);
  } else if (isAdminViewing) {
    partnerName = 'All Partners';
  }

  return {
    partnerName,
    tag: tag || null,
    isAdmin: isAdminViewing,
    approvedOnly: isAdminViewing ? approvedOnlyParam : true,
    eventCount: parties.length,
    dateRange,
    stats: {
      totalRsvps,
      approvedGuests,
      mailingListSignups: optinField ? mailingListSignups : null,
      walletAddresses,
      poapMints,
      poapMoments,
      socialPostViews,
      socialPostCount,
    },
    impressions: { totalViews, uniqueVisitors },
    clickStats: { totalClicks, uniqueClickers, byLink },
    notableAttendees: combinedNotable,
    industryOrgs,
    socialPosts: combinedSocialPosts,
    featuredPhotos,
    walletAddressList,
    events,
  };
}
