import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { countryCodeToRegion, countryNameToRegion } from './gpp.routes.js';
import { SIDE_TAG, slugFromName, assertSideAuthorized } from '../helpers/side.js';
import { getReimbursementTiers } from '../lib/privateConfig.js';

/**
 * rigatoni-58919 — "side" (PizzaDAO conference side-event) admin/underboss-gated
 * create flow + budget approval + side-event agreement.
 *
 * Clone-and-adapt of gpp27.routes.ts. Key differences:
 *   - NOT city-based: host enters the event name, date + start/end time, venue.
 *   - The public slug is derived from the event NAME (slugFromName).
 *   - NO city tiers / budget-suggestion: the reimbursement cap is admin/UB-set
 *     in the form, defaulting to + clamped at the configured ceiling.
 *
 * Every mutating endpoint is server-side gated to admins + the underboss in
 * scope for the target region (assertSideAuthorized). Created events carry the
 * SIDE_TAG so the public resolver (event.routes.ts) hides them from out-of-scope
 * viewers until publish.
 */

const router = Router();

const SIDE_DESCRIPTION = `A PizzaDAO conference side event — join us for pizza and good vibes alongside the main programming.

What to expect:
- Free pizza
- Pizza & crypto community
- Good conversations

RSVP to secure your slice!`;

/** Read the configured per-event reimbursement ceiling, fallback $625. */
async function ceilingUsd(): Promise<number> {
  const { ceilingUsd: c } = await getReimbursementTiers();
  return typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : 625;
}

// Convert a local wall-clock date+time in a timezone to a UTC Date.
function localToUTC(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const utcGuess = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const fmt = (timeZone: string) => new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parse = (str: string) => {
    const m = str.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
    return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]) : 0;
  };
  const offset = parse(fmt(tz).format(utcGuess)) - parse(fmt('UTC').format(utcGuess));
  return new Date(utcGuess.getTime() - offset);
}

/**
 * Parse a `YYYY-MM-DD` date + `HH:MM` (24h) time into a UTC Date, interpreted in
 * the given timezone. Returns null when either part is missing/malformed.
 */
function parseLocalDateTime(date: unknown, time: unknown, tz: string): Date | null {
  if (typeof date !== 'string') return null;
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return null;
  const t = typeof time === 'string' ? time : '';
  const tm = t.match(/^(\d{1,2}):(\d{2})$/);
  const hour = tm ? +tm[1] : 18;
  const minute = tm ? +tm[2] : 0;
  return localToUTC(+dm[1], +dm[2] - 1, +dm[3], hour, minute, tz);
}

// ---------------------------------------------------------------------------
// GET /api/side/agreement — active side-event agreement clauses + version.
// Auth-gated (admin/UB) since the whole side flow is gated pre-launch.
// ---------------------------------------------------------------------------
router.get('/agreement', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertSideAuthorized(req.userEmail, {});
    const clauses = await prisma.sideAgreementClause.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, version: true, sortOrder: true, heading: true, body: true, requiresAck: true },
    });
    const version = clauses[0]?.version ?? null;
    res.json({ version, clauses });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/side/events — mint a side party (admin/UB gated).
// Body: { name, hostName, email, telegram, timezone?, date, startTime?,
//         endTime?, formattedName?, lat?, lng?, country?, countryCode?,
//         reimbursementCapUsd?, agreementVersion, acceptedClauseIds }
// ---------------------------------------------------------------------------
router.post('/events', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, hostName, email, telegram, timezone,
      date, startTime, endTime,
      formattedName, lat, lng, country, countryCode,
      reimbursementCapUsd, agreementVersion, acceptedClauseIds,
    } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Event name is required', 400, 'VALIDATION_ERROR');
    }
    if (!hostName || typeof hostName !== 'string' || hostName.trim().length === 0) {
      throw new AppError('Host name is required', 400, 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError('Valid email is required', 400, 'VALIDATION_ERROR');
    }
    if (!telegram || typeof telegram !== 'string' || telegram.trim().length === 0) {
      throw new AppError('Telegram is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedName = name.trim();

    // The venue's country/countryCode drives the underboss scope (region).
    const inferredRegion = (countryCode ? countryCodeToRegion(countryCode) : null)
      || (country ? countryNameToRegion(country) : null);

    // Server-side scope gate: admin OR underboss in scope for this region.
    await assertSideAuthorized(req.userEmail, { region: inferredRegion });

    // Confirm the side-event agreement BEFORE persisting any row. Validate the
    // posted version + required clause acks up front so a stale client can never
    // mint a hidden, half-configured event.
    if (!agreementVersion || typeof agreementVersion !== 'string') {
      throw new AppError('agreementVersion is required', 400, 'VALIDATION_ERROR');
    }
    if (!Array.isArray(acceptedClauseIds) || !acceptedClauseIds.every((id) => typeof id === 'string')) {
      throw new AppError('acceptedClauseIds must be an array of strings', 400, 'VALIDATION_ERROR');
    }

    const activeClauses = await prisma.sideAgreementClause.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, version: true, requiresAck: true },
    });
    if (activeClauses.length === 0) {
      throw new AppError('No active agreement is configured', 409, 'NO_ACTIVE_AGREEMENT');
    }
    const currentAgreementVersion = activeClauses[0].version;
    if (agreementVersion !== currentAgreementVersion) {
      throw new AppError('The agreement has changed — please reload and re-confirm.', 409, 'AGREEMENT_VERSION_STALE');
    }
    const ackedSet = new Set(acceptedClauseIds);
    const allRequiredAcked = activeClauses
      .filter((c) => c.requiresAck === true)
      .every((c) => ackedSet.has(c.id));
    if (!allRequiredAcked) {
      throw new AppError('All required agreement clauses must be confirmed.', 409, 'AGREEMENT_NOT_ACCEPTED');
    }

    // Clamp the operator-approved reimbursement cap to the configured ceiling.
    // Omitted / 0 / non-number → 0 (a side event legitimately starts pending).
    const ceiling = await ceilingUsd();
    const rawCap = reimbursementCapUsd;
    const clampedCapUsd = (typeof rawCap === 'number' && Number.isFinite(rawCap) && rawCap > 0)
      ? Math.min(Math.round(rawCap), ceiling)
      : 0;

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedHostName = hostName.trim();
    const normalizedTelegram = typeof telegram === 'string' ? telegram.trim().replace(/^@/, '') || null : null;

    const eventTimezone = (typeof timezone === 'string' && timezone.trim()) || 'America/New_York';
    const venueAddress = (typeof formattedName === 'string' && formattedName.trim()) || normalizedName;

    // Host-chosen date + start/end time. Default to a 3-hour block when only the
    // start is provided; fall back to "now" when no date is supplied at all.
    const startDate = parseLocalDateTime(date, startTime, eventTimezone) || new Date();
    const endDate = parseLocalDateTime(date, endTime, eventTimezone)
      || new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

    const resolvedLat = typeof lat === 'number' && lat >= -90 && lat <= 90 ? lat : null;
    const resolvedLng = typeof lng === 'number' && lng >= -180 && lng <= 180 ? lng : null;

    // Derive a unique customUrl from the event name. Prefer the bare slug; on
    // collision append an incrementing numeric suffix (slug-2, slug-3, …).
    const baseSlug = slugFromName(normalizedName);
    let customUrl: string | null = null;
    if (baseSlug.length > 0) {
      const candidates = [baseSlug];
      for (let i = 2; i <= 50; i++) candidates.push(`${baseSlug}-${i}`);
      for (const cand of candidates) {
        const existing = await prisma.party.findUnique({ where: { customUrl: cand }, select: { id: true } });
        if (!existing) { customUrl = cand; break; }
      }
    }

    // Seed hidden underboss co-hosts for the inferred region (mirror GPP flow).
    let underbossCoHosts: any[] = [];
    if (inferredRegion) {
      const underbosses = await prisma.underboss.findMany({
        where: { isActive: true, OR: [{ region: inferredRegion }, { regions: { has: inferredRegion } }] },
        select: { name: true, email: true },
      });
      underbossCoHosts = underbosses.map((ub) => ({
        id: crypto.randomUUID(),
        name: ub.name,
        email: ub.email.toLowerCase(),
        showOnEvent: false,
        canEdit: true,
        isUnderboss: true,
      }));
    }

    // Find or create the host user.
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: normalizedEmail, name: normalizedHostName, telegram: normalizedTelegram },
      });
    } else if (normalizedTelegram) {
      await prisma.user.update({ where: { id: user.id }, data: { telegram: normalizedTelegram } });
    }

    const party = await prisma.party.create({
      data: {
        name: normalizedName,
        description: SIDE_DESCRIPTION,
        eventType: 'side',
        // SIDE_TAG drives the pre-launch public-resolver gate. 'side' is the
        // public taxonomy tag.
        eventTags: ['side', SIDE_TAG],
        requireApproval: true,
        hideGuests: false,
        photosEnabled: true,
        photosPublic: true,
        customUrl,
        date: startDate,
        endTime: endDate,
        duration: 3,
        timezone: eventTimezone,
        region: inferredRegion,
        country: country || null,
        // city/region drive underboss scope; use the venue's country as the
        // "city" surrogate for scope-matching (side events aren't city-based).
        city: country || null,
        address: venueAddress,
        latitude: resolvedLat,
        longitude: resolvedLng,
        availableBeverages: [],
        availableToppings: [],
        coHosts: [
          { id: crypto.randomUUID(), name: 'PizzaDAO', email: 'hello@rarepizzas.com', showOnEvent: true },
          { id: crypto.randomUUID(), name: normalizedHostName, email: normalizedEmail, showOnEvent: false, canEdit: true },
          ...underbossCoHosts,
        ],
        userId: user.id,
        agreementAcceptedAt: new Date(),
        agreementVersion: currentAgreementVersion,
        reimbursementCapUsd: clampedCapUsd,
      },
    });

    // Add the host as an approved guest (mirror GPP flow).
    await prisma.guest.create({
      data: {
        name: normalizedHostName,
        email: normalizedEmail,
        dietaryRestrictions: [],
        likedToppings: [],
        dislikedToppings: [],
        likedBeverages: [],
        dislikedBeverages: [],
        submittedVia: 'host',
        partyId: party.id,
        approved: true,
      },
    });

    const publicSlug = customUrl || party.inviteCode;
    res.status(201).json({
      success: true,
      event: {
        id: party.id,
        name: party.name,
        inviteCode: party.inviteCode,
        customUrl: party.customUrl,
        city: party.city,
        region: party.region,
      },
      // Side events resolve via the NORMAL slug (no ?year=).
      eventPageUrl: `/${publicSlug}`,
      hostPageUrl: `/host/${party.inviteCode}`,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/side/parties/:partyId/budget — set the approved reimbursement cap
// (admin/UB). Clamped to the configured ceiling.
// ---------------------------------------------------------------------------
router.patch('/parties/:partyId/budget', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, city: true, region: true, eventType: true },
    });
    if (!party) throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');

    await assertSideAuthorized(req.userEmail, { city: party.city, region: party.region });

    const raw = req.body?.reimbursementCapUsd;
    if (raw == null || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new AppError('reimbursementCapUsd must be a non-negative number', 400, 'VALIDATION_ERROR');
    }
    const ceiling = await ceilingUsd();
    const capped = Math.min(Math.round(raw), ceiling);

    await prisma.party.update({
      where: { id: partyId },
      data: { reimbursementCapUsd: capped },
    });

    res.json({ success: true, reimbursementCapUsd: capped, ceilingUsd: ceiling });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/side/parties/:partyId/agreement/accept — persist the host's
// sign-off. Records agreement_accepted_at + the CURRENT active version.
// ---------------------------------------------------------------------------
router.post('/parties/:partyId/agreement/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, city: true, region: true },
    });
    if (!party) throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');

    await assertSideAuthorized(req.userEmail, { city: party.city, region: party.region });

    const current = await prisma.sideAgreementClause.findFirst({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { version: true },
    });
    if (!current) throw new AppError('No active agreement is configured', 409, 'NO_ACTIVE_AGREEMENT');

    await prisma.party.update({
      where: { id: partyId },
      data: { agreementAcceptedAt: new Date(), agreementVersion: current.version },
    });

    res.json({ success: true, agreementVersion: current.version, agreementAcceptedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/side/parties/:partyId/publish-status — report which publish gates
// are satisfied (agreement signed for current version + valid merch address).
// ---------------------------------------------------------------------------
router.get('/parties/:partyId/publish-status', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const status = await computePublishStatus(partyId, req.userEmail);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/side/parties/:partyId/publish — flip the event public, but only
// when BOTH gates pass (server-enforced): the host has signed the CURRENT
// agreement version AND a valid merch delivery address exists.
// ---------------------------------------------------------------------------
router.post('/parties/:partyId/publish', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const status = await computePublishStatus(partyId, req.userEmail);

    if (!status.canPublish) {
      throw new AppError(
        'Cannot publish: agreement must be signed for the current version and a valid merch delivery address must be provided.',
        409,
        'PUBLISH_GATE_BLOCKED',
      );
    }

    // Remove the pre-launch gate tag so the public resolver exposes the event.
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { eventTags: true },
    });
    const newTags = (party?.eventTags || []).filter((t) => t !== SIDE_TAG);
    await prisma.party.update({ where: { id: partyId }, data: { eventTags: newTags } });

    res.json({ success: true, published: true });
  } catch (error) {
    next(error);
  }
});

interface PublishStatus {
  partyId: string;
  agreementSigned: boolean;
  agreementVersionMatches: boolean;
  hasMerchAddress: boolean;
  currentAgreementVersion: string | null;
  signedAgreementVersion: string | null;
  canPublish: boolean;
}

async function computePublishStatus(partyId: string, viewerEmail: string | null | undefined): Promise<PublishStatus> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      city: true,
      region: true,
      agreementAcceptedAt: true,
      agreementVersion: true,
      partyKit: { select: { addressLine1: true, city: true, postalCode: true } },
    },
  });
  if (!party) throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');

  await assertSideAuthorized(viewerEmail, { city: party.city, region: party.region });

  const current = await prisma.sideAgreementClause.findFirst({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: { version: true },
  });
  const currentVersion = current?.version ?? null;

  const agreementSigned = !!party.agreementAcceptedAt;
  const agreementVersionMatches = agreementSigned && !!currentVersion && party.agreementVersion === currentVersion;

  // A "valid merch delivery address" reuses the existing party_kits shipping
  // record (address_line1 + city + postal_code).
  const kit = party.partyKit;
  const hasMerchAddress = !!(kit && kit.addressLine1?.trim() && kit.city?.trim() && kit.postalCode?.trim());

  return {
    partyId: party.id,
    agreementSigned,
    agreementVersionMatches,
    hasMerchAddress,
    currentAgreementVersion: currentVersion,
    signedAgreementVersion: party.agreementVersion,
    canPublish: agreementVersionMatches && hasMerchAddress,
  };
}

export default router;
