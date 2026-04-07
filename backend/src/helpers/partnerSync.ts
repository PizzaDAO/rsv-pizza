import { prisma } from '../config/database.js';
import crypto from 'crypto';

/**
 * Partner sync helpers.
 *
 * When a SponsorUser has `autoCoHost: true`, any event tagged with its `tag`
 * should automatically receive a protected co-host entry (isPartner: true).
 * Optionally, a Sponsor record is also created if `autoSponsor: true`.
 */

interface SponsorUserLike {
  id: string;
  tag: string;
  coHostName: string | null;
  coHostWebsite: string | null;
  coHostTwitter: string | null;
  coHostInstagram: string | null;
  coHostAvatarUrl: string | null;
  coHostLogoUrl: string | null;
  autoCoHost: boolean;
  autoSponsor: boolean;
  name: string | null;
  email: string;
}

interface PartyLike {
  id: string;
  coHosts: any;
  eventTags: string[];
}

function buildPartnerCoHost(sponsorUser: SponsorUserLike): Record<string, any> {
  return {
    id: `partner-${crypto.randomUUID()}`,
    name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
    website: sponsorUser.coHostWebsite || undefined,
    twitter: sponsorUser.coHostTwitter || undefined,
    instagram: sponsorUser.coHostInstagram || undefined,
    avatar_url: sponsorUser.coHostAvatarUrl || undefined,
    showOnEvent: true,
    canEdit: false,
    isPartner: true,
    partnerTag: sponsorUser.tag,
  };
}

/**
 * Add a partner as co-host (and optionally sponsor) to a single party.
 * Idempotent: skips if a partner entry with the same tag already exists.
 */
export async function addPartnerToParty(
  party: PartyLike,
  sponsorUser: SponsorUserLike
): Promise<void> {
  const existingCoHosts: any[] = Array.isArray(party.coHosts) ? party.coHosts : [];

  // Check if partner co-host already exists for this tag
  const alreadyPresent = existingCoHosts.some(
    (h: any) => h.isPartner === true && h.partnerTag === sponsorUser.tag
  );
  if (alreadyPresent) return;

  const partnerEntry = buildPartnerCoHost(sponsorUser);
  const updatedCoHosts = [...existingCoHosts, partnerEntry];

  await prisma.party.update({
    where: { id: party.id },
    data: { coHosts: updatedCoHosts },
  });

  // Optionally create a Sponsor record
  if (sponsorUser.autoSponsor) {
    // Check if a sponsor with this name already exists on this event
    const existingSponsor = await prisma.sponsor.findFirst({
      where: {
        partyId: party.id,
        name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
      },
    });

    if (!existingSponsor) {
      await prisma.sponsor.create({
        data: {
          partyId: party.id,
          name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
          website: sponsorUser.coHostWebsite || null,
          brandTwitter: sponsorUser.coHostTwitter || null,
          brandInstagram: sponsorUser.coHostInstagram || null,
          logoUrl: sponsorUser.coHostLogoUrl || null,
          contactEmail: sponsorUser.email,
          status: 'yes',
          notes: `Auto-created from partner tag "${sponsorUser.tag}"`,
        },
      });
    }
  }
}

/**
 * Remove partner co-host entries matching a tag from a single party.
 */
export async function removePartnerFromParty(
  partyId: string,
  tag: string
): Promise<void> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { coHosts: true },
  });
  if (!party) return;

  const existingCoHosts: any[] = Array.isArray(party.coHosts) ? party.coHosts : [];
  const filtered = existingCoHosts.filter(
    (h: any) => !(h.isPartner === true && h.partnerTag === tag)
  );

  if (filtered.length !== existingCoHosts.length) {
    await prisma.party.update({
      where: { id: partyId },
      data: { coHosts: filtered },
    });
  }
}

/**
 * Sync a partner to ALL events that currently have the matching tag.
 * Used when a SponsorUser is created/updated with autoCoHost: true.
 */
export async function syncPartnerToAllEvents(
  sponsorUser: SponsorUserLike
): Promise<number> {
  if (!sponsorUser.autoCoHost) return 0;

  const events = await prisma.party.findMany({
    where: { eventTags: { has: sponsorUser.tag } },
    select: { id: true, coHosts: true, eventTags: true },
  });

  let synced = 0;
  for (const event of events) {
    const existingCoHosts: any[] = Array.isArray(event.coHosts) ? event.coHosts : [];
    const alreadyPresent = existingCoHosts.some(
      (h: any) => h.isPartner === true && h.partnerTag === sponsorUser.tag
    );
    if (!alreadyPresent) {
      await addPartnerToParty(event as PartyLike, sponsorUser);
      synced++;
    }
  }

  return synced;
}

/**
 * Remove partner co-host entries from ALL events for a given tag.
 * Used when a SponsorUser is deactivated or autoCoHost is toggled off.
 */
export async function removePartnerFromAllEvents(tag: string): Promise<number> {
  // Use raw query to find events with partner co-hosts matching this tag
  const events = await prisma.party.findMany({
    where: { eventTags: { has: tag } },
    select: { id: true, coHosts: true },
  });

  let removed = 0;
  for (const event of events) {
    const existingCoHosts: any[] = Array.isArray(event.coHosts) ? event.coHosts : [];
    const hasPartner = existingCoHosts.some(
      (h: any) => h.isPartner === true && h.partnerTag === tag
    );
    if (hasPartner) {
      await removePartnerFromParty(event.id, tag);
      removed++;
    }
  }

  return removed;
}

/**
 * Get all SponsorUsers that have autoCoHost enabled for a given set of tags.
 */
export async function getAutoCoHostPartners(tags: string[]): Promise<SponsorUserLike[]> {
  if (tags.length === 0) return [];

  const partners = await prisma.sponsorUser.findMany({
    where: {
      tag: { in: tags },
      autoCoHost: true,
      isActive: true,
    },
  });

  return partners as SponsorUserLike[];
}
