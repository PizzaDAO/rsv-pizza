import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { countryCodeToRegion, countryNameToRegion } from './gpp.routes.js';
import {
  GPP27_YEAR,
  GPP27_TAG,
  citySlugFromCityName,
  assertGpp27Authorized,
  computeReimbursementCap,
} from '../helpers/gpp27.js';
import { getCityTiers, getReimbursementTiers } from '../lib/privateConfig.js';

/**
 * soppressata-50927 — GPP27 (Bitcoin Pizza Day 2027) admin/underboss-gated
 * create flow + budget approval + City Host Agreement.
 *
 * Every mutating endpoint here is server-side gated to admins + the underboss
 * in scope for the target city (assertGpp27Authorized). Created events carry
 * the GPP27_TAG so the public resolver (event.routes.ts) hides them from
 * out-of-scope viewers until launch.
 */

const router = Router();

const GPP27_DESCRIPTION = `Join us for the Global Pizza Party, a worldwide celebration of pizza and bitcoin, where communities around the world come together to share pizza and good vibes.

What to expect:
- Free pizza
- Crypto enthusiasts
- Good conversations

RSVP to secure your slice!`;

// Convert a local wall-clock time in a timezone to a UTC Date.
function localToUTC(year: number, month: number, day: number, hour: number, tz: string): Date {
  const utcGuess = new Date(Date.UTC(year, month, day, hour, 0, 0));
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
 * Look up last year's (2026) GPP party for a city by normalized city-slug and
 * return its day-of estimated_attendance. New city => null.
 */
async function lastYearEstimatedAttendance(citySlug: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ estimated_attendance: number | null }>>`
    SELECT estimated_attendance
    FROM parties
    WHERE event_type = 'gpp'
      AND date IS NOT NULL
      AND EXTRACT(YEAR FROM date)::int = 2026
      AND (
        custom_url = ${citySlug}
        OR regexp_replace(lower(unaccent(coalesce(city, ''))), '[^a-z0-9]', '', 'g') = ${citySlug}
      )
    ORDER BY estimated_attendance DESC NULLS LAST
    LIMIT 1
  `;
  return rows[0]?.estimated_attendance ?? null;
}

/**
 * Count current direct RSVPs for a party (approved or pending — excludes
 * rejected). Used as the 0.40× term in the budget suggestion.
 */
async function currentRsvpCount(partyId: string): Promise<number> {
  return prisma.guest.count({
    where: { partyId, OR: [{ approved: true }, { approved: null }] },
  });
}

// ---------------------------------------------------------------------------
// GET /api/gpp27/agreement — active City Host Agreement clauses + version.
// Auth-gated (admin/UB) since the whole 2027 flow is gated pre-launch.
// ---------------------------------------------------------------------------
router.get('/agreement', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertGpp27Authorized(req.userEmail, {});
    const clauses = await prisma.gppAgreementClause.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, version: true, sortOrder: true, body: true, requiresAck: true },
    });
    const version = clauses[0]?.version ?? null;
    res.json({ version, clauses });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/gpp27/budget-suggestion?city=...&partyId=... — pre-filled cap.
// Returns the transparent inputs (last-year #, rsvp #, tier, per-head rate)
// plus the suggested + $625-clamped cap.
// ---------------------------------------------------------------------------
router.get('/budget-suggestion', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const partyId = typeof req.query.partyId === 'string' ? req.query.partyId : null;
    if (!city) throw new AppError('city is required', 400, 'VALIDATION_ERROR');

    await assertGpp27Authorized(req.userEmail, { city });

    const citySlug = citySlugFromCityName(city);
    const lastYear = await lastYearEstimatedAttendance(citySlug);
    const rsvpCount = partyId ? await currentRsvpCount(partyId) : 0;

    // Resolve city-tier + reimbursement config from app_config (60s-cached).
    const [cityTiers, reimb] = await Promise.all([getCityTiers(), getReimbursementTiers()]);

    const s = computeReimbursementCap(
      {
        cityName: city,
        lastYearEstimatedAttendance: lastYear,
        currentRsvpCount: rsvpCount,
      },
      {
        tiers: cityTiers,
        rates: reimb.perHeadRates,
        ceilingUsd: reimb.ceilingUsd,
        coefficient: reimb.attendanceRsvpCoefficient,
      },
    );

    res.json({
      city,
      tier: s.tier,
      perHeadRate: s.perHead,
      lastYearEstimatedAttendance: lastYear,
      currentRsvpCount: rsvpCount,
      expectedAttendance: s.expectedAttendance,
      rawSuggestedCapUsd: s.rawSuggested,
      suggestedCapUsd: s.cappedSuggested,
      ceilingUsd: reimb.ceilingUsd,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/gpp27/events — mint a 2027 GPP party (admin/UB gated).
// Body: { city, hostName, email, telegram?, country?, countryCode?,
//         cityFormattedName?, cityLat?, cityLng?, timezone? }
// ---------------------------------------------------------------------------
router.post('/events', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { city, hostName, email, telegram, country, countryCode, cityFormattedName, cityLat, cityLng, timezone } = req.body || {};

    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      throw new AppError('City is required', 400, 'VALIDATION_ERROR');
    }
    if (!hostName || typeof hostName !== 'string' || hostName.trim().length === 0) {
      throw new AppError('Host name is required', 400, 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError('Valid email is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedCity = city.trim();

    // Server-side scope gate: admin OR underboss in scope for this city.
    await assertGpp27Authorized(req.userEmail, { city: normalizedCity });

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedHostName = hostName.trim();
    const normalizedTelegram = typeof telegram === 'string' ? telegram.trim().replace(/^@/, '') || null : null;

    const cityAddress = (typeof cityFormattedName === 'string' && cityFormattedName.trim()) || normalizedCity;
    const eventName = `Global Pizza Party ${normalizedCity}`;
    const citySlug = citySlugFromCityName(normalizedCity);

    // Reject duplicate 2027 events for the same city.
    const dupRows = await prisma.$queryRaw<Array<{ id: string; custom_url: string | null; invite_code: string }>>`
      SELECT id, custom_url, invite_code
      FROM parties
      WHERE event_type = 'gpp'
        AND date IS NOT NULL
        AND EXTRACT(YEAR FROM date)::int = ${GPP27_YEAR}
        AND lower(unaccent(name)) = lower(unaccent(${eventName}))
      LIMIT 1
    `;
    if (dupRows[0]) {
      throw new AppError(
        `A ${GPP27_YEAR} Global Pizza Party for ${normalizedCity} already exists.`,
        409,
        'DUPLICATE_CITY',
      );
    }

    // Pick a unique customUrl. Prefer the bare citySlug; if taken (e.g. the
    // 2026 event owns it), suffix with the 2-digit year (`austin27`); if that
    // is also taken, append an incrementing counter.
    let customUrl: string | null = null;
    if (citySlug.length > 0) {
      const candidates = [citySlug, `${citySlug}${String(GPP27_YEAR).slice(2)}`];
      for (let i = 2; i <= 9; i++) candidates.push(`${citySlug}${String(GPP27_YEAR).slice(2)}-${i}`);
      for (const cand of candidates) {
        const existing = await prisma.party.findUnique({ where: { customUrl: cand }, select: { id: true } });
        if (!existing) { customUrl = cand; break; }
      }
    }

    const eventTimezone = (typeof timezone === 'string' && timezone.trim()) || 'America/New_York';
    const defaultDate = localToUTC(GPP27_YEAR, 4, 22, 18, eventTimezone);    // May 22 2027 6 PM local
    const defaultEndDate = localToUTC(GPP27_YEAR, 4, 22, 21, eventTimezone); // 9 PM local

    const resolvedLat = typeof cityLat === 'number' && cityLat >= -90 && cityLat <= 90 ? cityLat : null;
    const resolvedLng = typeof cityLng === 'number' && cityLng >= -180 && cityLng <= 180 ? cityLng : null;

    const inferredRegion = (countryCode ? countryCodeToRegion(countryCode) : null)
      || (country ? countryNameToRegion(country) : null);

    // Seed hidden underboss co-hosts for the inferred region (mirror 2026 flow).
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
        name: eventName,
        description: GPP27_DESCRIPTION,
        eventType: 'gpp',
        // GPP27_TAG drives the pre-launch public-resolver gate.
        eventTags: ['Global Pizza Party', 'wpc', 'ens', GPP27_TAG],
        requireApproval: true,
        hideGuests: false,
        photosEnabled: true,
        photosPublic: true,
        customUrl,
        date: defaultDate,
        endTime: defaultEndDate,
        duration: 3,
        timezone: eventTimezone,
        region: inferredRegion,
        country: country || null,
        city: normalizedCity,
        address: cityAddress,
        addressIsCityDefault: true,
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
      },
    });

    // Add the host as an approved guest (mirror 2026 flow).
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
        year: GPP27_YEAR,
      },
      // Canonical (gated) public URL for the 2027 edition.
      eventPageUrl: `/${publicSlug}?year=${GPP27_YEAR}`,
      hostPageUrl: `/host/${party.inviteCode}`,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/gpp27/parties/:partyId/budget — set the approved reimbursement cap
// (admin/UB). Clamped to $625.
// ---------------------------------------------------------------------------
router.patch('/parties/:partyId/budget', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, city: true, region: true, eventType: true },
    });
    if (!party) throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');

    await assertGpp27Authorized(req.userEmail, { city: party.city, region: party.region });

    const raw = req.body?.reimbursementCapUsd;
    if (raw == null || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new AppError('reimbursementCapUsd must be a non-negative number', 400, 'VALIDATION_ERROR');
    }
    // Clamp to the configured per-event ceiling (app_config, 60s-cached).
    const { ceilingUsd } = await getReimbursementTiers();
    const capped = Math.min(Math.round(raw), ceilingUsd);

    await prisma.party.update({
      where: { id: partyId },
      data: { reimbursementCapUsd: capped },
    });

    res.json({ success: true, reimbursementCapUsd: capped, ceilingUsd });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/gpp27/parties/:partyId/agreement/accept — persist the host's
// sign-off (admin/UB acting on behalf, or the host themselves once the flow is
// host-facing). Records agreement_accepted_at + the CURRENT active version.
// ---------------------------------------------------------------------------
router.post('/parties/:partyId/agreement/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, city: true, region: true },
    });
    if (!party) throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');

    await assertGpp27Authorized(req.userEmail, { city: party.city, region: party.region });

    // Determine the current active agreement version.
    const current = await prisma.gppAgreementClause.findFirst({
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
// GET /api/gpp27/parties/:partyId/publish-status — report which publish gates
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
// POST /api/gpp27/parties/:partyId/publish — flip the event public, but only
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
    const newTags = (party?.eventTags || []).filter((t) => t !== GPP27_TAG);
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

  await assertGpp27Authorized(viewerEmail, { city: party.city, region: party.region });

  const current = await prisma.gppAgreementClause.findFirst({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: { version: true },
  });
  const currentVersion = current?.version ?? null;

  const agreementSigned = !!party.agreementAcceptedAt;
  const agreementVersionMatches = agreementSigned && !!currentVersion && party.agreementVersion === currentVersion;

  // A "valid merch delivery address" reuses the existing party_kits shipping
  // record (recipient_name + address_line1 + city + postal_code). We require
  // the core lines to be non-empty.
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
