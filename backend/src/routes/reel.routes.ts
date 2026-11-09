/**
 * Sizzle reel routes.
 *
 * Host router (mounted at /api/parties):
 *   GET  /:partyId/reels            list reels + eligibility + music choices
 *   POST /:partyId/reels            queue a reel (host / co-host with edit rights, after the event date; admins any time)
 *   GET  /:partyId/reels/:reelId    one reel (poll for status)
 *
 * Admin router (mounted at /api/admin/reels, before the /api/admin catch-all):
 *   GET  /settings                  current reel settings
 *   PUT  /settings                  update (admin only; clamped by normalizeReelSettings)
 *   GET  /music-library             every track in the music bucket + which are eligible
 *
 * Rendering happens on the Railway reel-worker, which polls the `reels` table.
 */
import { Router, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, isAdmin, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { brand } from '../config/brand.js';
import { invalidate } from '../lib/privateConfig.js';
import { getReelSettings, normalizeReelSettings, REEL_SETTINGS_KEY } from '../lib/reelConfig.js';
import { selectReelPhotos } from '../lib/reelSelection.js';
import { checkReelPermission } from '../lib/reelPermissions.js';
import { buildReelSpec, cleanTitle, ALL_RATIOS, type ReelRatio } from '../lib/reelSpec.js';
import {
  filterEligibleTracks,
  isSafeTrackKey,
  listMusicLibraryKeys,
  musicLibraryConfigured,
  pickAutoTrack,
  trackFromKey,
} from '../lib/reelMusic.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SPONSOR_OK_STATUSES = ['yes', 'billed', 'paid'];

function serializeReel(r: {
  id: string;
  status: string;
  progress: number;
  outputs: unknown;
  error: string | null;
  spec: unknown;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  const spec = (r.spec ?? {}) as { title?: string; music?: { title?: string } | null; timeline?: { totalSeconds?: number } };
  return {
    id: r.id,
    status: r.status,
    progress: r.progress,
    outputs: r.status === 'ready' ? r.outputs : null,
    // Worker errors can carry internals; hosts only see that it failed.
    error: r.status === 'failed' ? 'Rendering failed. Try again in a few minutes.' : null,
    title: spec.title ?? null,
    musicTitle: spec.music?.title ?? null,
    durationSeconds: spec.timeline?.totalSeconds ?? null,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

async function loadParty(partyId: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      name: true,
      city: true,
      date: true,
      timezone: true,
      cancelledAt: true,
      photosEnabled: true,
      eventSeriesId: true,
    },
  });
  if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');
  return party;
}

async function resolveAccess(req: AuthRequest, partyId: string, party: { date: Date | null; cancelledAt: Date | null }) {
  const [canEdit, admin] = await Promise.all([
    canUserEditParty(partyId, req.userId, req.userEmail),
    isAdminish(req.userEmail),
  ]);
  const permission = checkReelPermission({
    canEdit,
    isAdmin: admin,
    partyDate: party.date,
    cancelledAt: party.cancelledAt,
    now: new Date(),
  });
  return { canEdit, isAdmin: admin, permission };
}

async function isAdminish(email?: string): Promise<boolean> {
  return (await isSuperAdmin(email)) || (await isAdmin(email));
}

async function eligibleTracks() {
  const settings = await getReelSettings();
  let keys: string[] = [];
  try {
    keys = await listMusicLibraryKeys();
  } catch (err) {
    console.warn('[reels] music library list failed', err);
  }
  return { settings, tracks: filterEligibleTracks(keys, settings) };
}

const reelRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as AuthRequest).userEmail || req.ip || 'anon',
  message: { error: 'Too many reel requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

// ------------------------------------------------------------------ host
export const reelRouter = Router();

reelRouter.get('/:partyId/reels', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const party = await loadParty(partyId);
    const access = await resolveAccess(req, partyId, party);
    if (!access.canEdit && !access.isAdmin) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    const [reels, { settings, tracks }, photoCount] = await Promise.all([
      prisma.reel.findMany({ where: { partyId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      eligibleTracks(),
      prisma.photo.count({
        where: { partyId, status: 'approved', deletedAt: null, mimeType: { startsWith: 'image/' } },
      }),
    ]);

    res.json({
      eligible: settings.enabled && access.permission.ok,
      reason: !settings.enabled ? 'Reels are turned off' : access.permission.ok ? null : access.permission.message,
      reasonCode: !settings.enabled ? 'DISABLED' : access.permission.ok ? null : access.permission.code,
      photoCount,
      minPhotos: settings.minPhotos,
      tracks: tracks.map((t) => ({ key: t.key, title: t.title, folder: t.folder })),
      reels: reels.map(serializeReel),
    });
  } catch (err) {
    next(err);
  }
});

reelRouter.get('/:partyId/reels/:reelId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, reelId } = req.params;
    const party = await loadParty(partyId);
    const access = await resolveAccess(req, partyId, party);
    if (!access.canEdit && !access.isAdmin) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    const reel = await prisma.reel.findFirst({ where: { id: reelId, partyId } });
    if (!reel) throw new AppError('Reel not found', 404, 'NOT_FOUND');
    res.json({ reel: serializeReel(reel) });
  } catch (err) {
    next(err);
  }
});

reelRouter.post('/:partyId/reels', requireAuth, reelRequestLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const body = (req.body ?? {}) as {
      title?: unknown;
      photoIds?: unknown;
      musicKey?: unknown;
      ratios?: unknown;
      excludeSponsorIds?: unknown;
    };
    const party = await loadParty(partyId);
    const access = await resolveAccess(req, partyId, party);
    if (!access.permission.ok) {
      const status = access.permission.code === 'FORBIDDEN' ? 403 : 409;
      throw new AppError(access.permission.message, status, access.permission.code);
    }
    const settings = await getReelSettings();
    if (!settings.enabled) throw new AppError('Reels are turned off', 403, 'DISABLED');
    if (!party.photosEnabled) throw new AppError('Photos are not enabled for this event', 409, 'PHOTOS_DISABLED');

    const email = req.userEmail ?? 'unknown';
    const [activeCount, userDaily] = await Promise.all([
      prisma.reel.count({ where: { partyId, status: { in: ['queued', 'rendering'] } } }),
      prisma.reel.count({ where: { requestedBy: email, createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
    ]);
    if (activeCount >= settings.maxActivePerParty) {
      throw new AppError('A reel is already being made for this event', 429, 'REEL_IN_PROGRESS');
    }
    if (userDaily >= settings.perUserDailyLimit) {
      throw new AppError('Daily reel limit reached, try again tomorrow', 429, 'DAILY_LIMIT');
    }

    const pickedIds = Array.isArray(body.photoIds)
      ? body.photoIds.filter((x): x is string => typeof x === 'string').slice(0, 60)
      : undefined;
    const candidates = await prisma.photo.findMany({
      where: { partyId, status: 'approved', deletedAt: null, mimeType: { startsWith: 'image/' } },
      select: {
        id: true, url: true, mimeType: true, width: true, height: true, starred: true,
        voteCount: true, payoutRole: true, status: true, deletedAt: true, createdAt: true,
      },
    });
    const photos = selectReelPhotos(candidates, settings.maxPhotos, pickedIds);
    if (photos.length < settings.minPhotos) {
      throw new AppError(
        `At least ${settings.minPhotos} approved photos are needed to make a reel`,
        422,
        'NOT_ENOUGH_PHOTOS',
      );
    }

    const excluded = new Set(
      Array.isArray(body.excludeSponsorIds) ? body.excludeSponsorIds.filter((x): x is string => typeof x === 'string') : [],
    );
    const sponsorRows = await prisma.sponsor.findMany({
      where: { partyId, status: { in: SPONSOR_OK_STATUSES }, logoUrl: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, logoUrl: true },
    });
    const sponsors = sponsorRows.filter((s) => s.logoUrl && !excluded.has(s.id));

    // Music: 'none' -> no-music only, a track key -> that track (must be eligible), else auto-pick.
    const reelId = randomUUID();
    let music: { key: string; title: string } | null = null;
    if (body.musicKey !== 'none') {
      const { tracks } = await eligibleTracks();
      if (typeof body.musicKey === 'string' && body.musicKey !== 'auto') {
        if (!isSafeTrackKey(body.musicKey) || !tracks.some((t) => t.key === body.musicKey)) {
          throw new AppError('That track is not available', 400, 'INVALID_TRACK');
        }
        const t = trackFromKey(body.musicKey);
        music = { key: t.key, title: t.title };
      } else {
        const t = pickAutoTrack(tracks, reelId);
        music = t ? { key: t.key, title: t.title } : null;
      }
    }

    const ratios = Array.isArray(body.ratios)
      ? (body.ratios.filter((r): r is ReelRatio => ALL_RATIOS.includes(r as ReelRatio)) as ReelRatio[])
      : undefined;

    const [series, guestCount] = await Promise.all([
      party.eventSeriesId
        ? prisma.eventSeries.findUnique({ where: { id: party.eventSeriesId }, select: { logoUrl: true } })
        : Promise.resolve(null),
      prisma.guest.count({ where: { partyId, status: 'CONFIRMED' } }),
    ]);

    const spec = buildReelSpec({
      reelId,
      partyId,
      title: cleanTitle(body.title, party.name),
      city: party.city,
      date: party.date,
      timezone: party.timezone,
      guestCount,
      siteDomain: brand.domain,
      ratios,
      photos,
      sponsors,
      gppLogoUrl: series?.logoUrl ?? null,
      music,
      settings,
    });

    const reel = await prisma.reel.create({
      data: { id: reelId, partyId, requestedBy: email, status: 'queued', spec: spec as unknown as Prisma.InputJsonValue },
    });

    void pingWorker();
    res.status(201).json({ reel: serializeReel(reel) });
  } catch (err) {
    next(err);
  }
});

/** Best-effort nudge so the worker renders now instead of waiting for its next poll. */
async function pingWorker(): Promise<void> {
  const url = process.env.REEL_WORKER_URL;
  const secret = process.env.REEL_WORKER_SECRET;
  if (!url || !secret) return;
  try {
    await fetch(`${url.replace(/\/+$/, '')}/wake`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The worker polls anyway.
  }
}

// ----------------------------------------------------------------- admin
export const adminReelRouter = Router();
adminReelRouter.use(requireAuth);

async function requireAdminAccess(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isAdminish(req.userEmail))) throw new AppError('Admin access required', 403, 'FORBIDDEN');
    next();
  } catch (err) {
    next(err);
  }
}
adminReelRouter.use(requireAdminAccess);

adminReelRouter.get('/settings', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ settings: await getReelSettings(), musicLibraryConfigured: musicLibraryConfigured() });
  } catch (err) {
    next(err);
  }
});

adminReelRouter.put('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = normalizeReelSettings(req.body?.settings ?? req.body);
    await prisma.appConfig.upsert({
      where: { key: REEL_SETTINGS_KEY },
      update: { value: JSON.stringify(settings), updatedAt: new Date() },
      create: { key: REEL_SETTINGS_KEY, value: JSON.stringify(settings) },
    });
    invalidate(REEL_SETTINGS_KEY);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

adminReelRouter.get('/music-library', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await getReelSettings();
    const keys = await listMusicLibraryKeys(true);
    const eligible = new Set(filterEligibleTracks(keys, settings).map((t) => t.key));
    const tracks = keys.map((k) => ({ ...trackFromKey(k), eligible: eligible.has(k) }));
    const folders = Array.from(new Set(tracks.map((t) => t.folder.split('/')[0]).filter(Boolean))).sort();
    res.json({ configured: musicLibraryConfigured(), folders, tracks });
  } catch (err) {
    next(err);
  }
});
