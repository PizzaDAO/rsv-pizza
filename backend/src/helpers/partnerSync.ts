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
  category: string | null;
  coHostShowOnEvent?: boolean;
  coHostCanEdit?: boolean;
  coHostAllowedTabs?: any;
  name: string | null;
  email: string;
  brandDescription: string | null;
  descriptionSortOrder: number;
}

interface PartyLike {
  id: string;
  coHosts: any;
  eventTags: string[];
}

function buildPartnerCoHost(sponsorUser: SponsorUserLike): Record<string, any> {
  const entry: Record<string, any> = {
    id: `partner-${crypto.randomUUID()}`,
    name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
    website: sponsorUser.coHostWebsite || undefined,
    twitter: sponsorUser.coHostTwitter || undefined,
    instagram: sponsorUser.coHostInstagram || undefined,
    avatar_url: sponsorUser.coHostAvatarUrl || undefined,
    showOnEvent: sponsorUser.coHostShowOnEvent !== false,
    canEdit: !!sponsorUser.coHostCanEdit,
    isPartner: true,
    partnerTag: sponsorUser.tag,
  };
  if (Array.isArray(sponsorUser.coHostAllowedTabs)) {
    entry.allowedTabs = sponsorUser.coHostAllowedTabs;
  }
  return entry;
}

/**
 * Find an existing sponsor record for a party, matching by contactEmail first,
 * then falling back to matching by name + auto-created notes pattern.
 * This prevents duplicates when a partner's email changes between syncs.
 */
async function findExistingSponsor(partyId: string, sponsorUser: SponsorUserLike) {
  // Primary match: contactEmail
  const byEmail = await prisma.sponsor.findFirst({
    where: { partyId, contactEmail: sponsorUser.email },
  });
  if (byEmail) return byEmail;

  // Fallback: match by name + auto-created note pattern for this tag
  const sponsorName = sponsorUser.coHostName || sponsorUser.name || sponsorUser.email;
  return prisma.sponsor.findFirst({
    where: {
      partyId,
      name: sponsorName,
      notes: `Auto-created from partner tag "${sponsorUser.tag}"`,
    },
  });
}

/**
 * Add or update a partner as co-host (and optionally sponsor) on a single party.
 * Idempotent: upserts co-host entry and sponsor row keyed by stable identifiers
 * so repeated calls don't create duplicates when partner details change.
 */
export async function addPartnerToParty(
  party: PartyLike,
  sponsorUser: SponsorUserLike
): Promise<void> {
  const existingCoHosts: any[] = Array.isArray(party.coHosts) ? party.coHosts : [];
  const partnerEntry = buildPartnerCoHost(sponsorUser);

  // Upsert co-host: replace existing entry with same partnerTag, preserving id
  const existingIdx = existingCoHosts.findIndex(
    (h: any) => h.isPartner === true && h.partnerTag === sponsorUser.tag
  );

  let updatedCoHosts: any[];
  if (existingIdx >= 0) {
    const existing = existingCoHosts[existingIdx];
    updatedCoHosts = [...existingCoHosts];
    updatedCoHosts[existingIdx] = { ...partnerEntry, id: existing.id };
  } else {
    updatedCoHosts = [...existingCoHosts, partnerEntry];
  }

  await prisma.party.update({
    where: { id: party.id },
    data: { coHosts: updatedCoHosts },
  });

  // Optionally upsert a Sponsor record (keyed by contactEmail, which is stable)
  if (sponsorUser.autoSponsor) {
    const sponsorData = {
      name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
      website: sponsorUser.coHostWebsite || null,
      brandTwitter: sponsorUser.coHostTwitter || null,
      brandInstagram: sponsorUser.coHostInstagram || null,
      brandDescription: sponsorUser.brandDescription || null,
      logoUrl: sponsorUser.coHostLogoUrl || null,
      category: sponsorUser.category || null,
      sortOrder: sponsorUser.descriptionSortOrder,
    };

    const existingSponsor = await findExistingSponsor(party.id, sponsorUser);

    let sponsorId: string;
    if (existingSponsor) {
      await prisma.sponsor.update({
        where: { id: existingSponsor.id },
        data: { ...sponsorData, contactEmail: sponsorUser.email },
      });
      sponsorId = existingSponsor.id;
    } else {
      const created = await prisma.sponsor.create({
        data: {
          ...sponsorData,
          partyId: party.id,
          contactEmail: sponsorUser.email,
          status: 'yes',
          notes: `Auto-created from partner tag "${sponsorUser.tag}"`,
        },
      });
      sponsorId = created.id;
    }

    // Copy quiz question templates to event quiz questions
    await syncQuizTemplatesToEvent(sponsorUser.id, party.id, sponsorId);
  }
}

/**
 * Copy quiz question templates from a sponsor user to an event's quiz questions.
 * Only copies templates that haven't already been copied (keyed by templateId).
 */
async function syncQuizTemplatesToEvent(
  sponsorUserId: string,
  partyId: string,
  sponsorId: string
): Promise<void> {
  const templates = await prisma.quizQuestionTemplate.findMany({
    where: { sponsorUserId },
    orderBy: { sortOrder: 'asc' },
  });

  if (templates.length === 0) return;

  // Check which templates are already copied
  const existingQuestions = await prisma.quizQuestion.findMany({
    where: { partyId, templateId: { in: templates.map(t => t.id) } },
    select: { templateId: true },
  });
  const existingTemplateIds = new Set(existingQuestions.map(q => q.templateId));

  // Get max sort order for this party's quiz questions
  const maxSort = await prisma.quizQuestion.aggregate({
    where: { partyId },
    _max: { sortOrder: true },
  });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  // Copy new templates
  for (const template of templates) {
    if (existingTemplateIds.has(template.id)) continue;

    await prisma.quizQuestion.create({
      data: {
        partyId,
        sponsorId,
        templateId: template.id,
        question: template.question,
        options: template.options as any,
        correctIndex: template.correctIndex,
        explanation: template.explanation,
        sortOrder: nextSort++,
      },
    });
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

  // Also remove auto-created sponsor records for this tag
  const autoNote = `Auto-created from partner tag "${tag}"`;
  await prisma.sponsor.deleteMany({
    where: {
      partyId,
      notes: autoNote,
    },
  });
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
    await addPartnerToParty(event as PartyLike, sponsorUser);
    synced++;
  }

  return synced;
}

/**
 * Sync ONLY sponsor rows (no co-host) to all events with the matching tag.
 * Used when autoSponsor is on but autoCoHost is off.
 */
export async function syncAutoSponsorsToAllEvents(
  sponsorUser: SponsorUserLike
): Promise<number> {
  if (!sponsorUser.autoSponsor) return 0;

  const events = await prisma.party.findMany({
    where: { eventTags: { has: sponsorUser.tag } },
    select: { id: true, coHosts: true, eventTags: true },
  });

  const sponsorData = {
    name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
    website: sponsorUser.coHostWebsite || null,
    brandTwitter: sponsorUser.coHostTwitter || null,
    brandInstagram: sponsorUser.coHostInstagram || null,
    brandDescription: sponsorUser.brandDescription || null,
    logoUrl: sponsorUser.coHostLogoUrl || null,
    category: sponsorUser.category || null,
    sortOrder: sponsorUser.descriptionSortOrder,
  };

  let synced = 0;
  for (const event of events) {
    const existingSponsor = await findExistingSponsor(event.id, sponsorUser);

    let sponsorId: string;
    if (existingSponsor) {
      await prisma.sponsor.update({
        where: { id: existingSponsor.id },
        data: { ...sponsorData, contactEmail: sponsorUser.email },
      });
      sponsorId = existingSponsor.id;
    } else {
      const created = await prisma.sponsor.create({
        data: {
          ...sponsorData,
          partyId: event.id,
          contactEmail: sponsorUser.email,
          status: 'yes',
          notes: `Auto-created from partner tag "${sponsorUser.tag}"`,
        },
      });
      sponsorId = created.id;
    }

    await syncQuizTemplatesToEvent(sponsorUser.id, event.id, sponsorId);
    synced++;
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
 * Remove auto-created sponsor rows for a given partner (by tag + contactEmail).
 * Only deletes rows whose notes match the auto-created pattern, so it never
 * touches sponsors that were manually added or edited out of auto status.
 */
export async function removeAutoSponsorsFromAllEvents(
  tag: string,
  contactEmail: string
): Promise<number> {
  const autoNote = `Auto-created from partner tag "${tag}"`;

  const events = await prisma.party.findMany({
    where: { eventTags: { has: tag } },
    select: { id: true },
  });

  if (events.length === 0) return 0;

  const result = await prisma.sponsor.deleteMany({
    where: {
      partyId: { in: events.map(e => e.id) },
      contactEmail,
      notes: autoNote,
    },
  });

  return result.count;
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
