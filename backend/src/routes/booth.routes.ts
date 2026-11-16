/**
 * Photo booth routes (plans/photo-booth.md section 3). Mounted at /api/parties, before partyRoutes.
 *
 * GET /:partyId/booth   (public; optionalAuth) -> { enabled, hostEnabled, globalEnabled, config, updatedAt, canEdit }
 *   enabled = global `booth.enabled` flag AND the host's toggle (no row = on) AND not cancelled.
 *   Public-cacheable for 60 s when there is no auth header, `private, no-store` otherwise. Never returns updatedBy.
 * PUT /:partyId/booth   (host / co-host with the booth tab; 410 when cancelled) body { enabled?, config? }
 *   config: object (sanitized) | null (reset to the PizzaDAO default) | omitted (unchanged).
 *
 * boothAdminRouter, mounted at /api/admin/booth (super admin): read / change the global flag
 * (audited by lib/appSettings.writeSetting).
 */
import express, { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { optionalAuth, requireAuth, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import { sanitizeBoothConfig } from '../lib/boothConfig.js';
import { BOOTH_ENABLED_SETTING, isBoothGloballyOn } from '../lib/boothSettings.js';
import { checkSettingChange, readSettings, writeSetting } from '../lib/appSettings.js';

const router = Router();

/** Route-level body parser (a logo data URL is too big for the global 100 KB default). Oversize -> 413. */
export const boothJsonBody = [
  express.json({ limit: '2mb' }),
  (err: any, _req: Request, _res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') return next(new AppError('config is too large', 413, 'PAYLOAD_TOO_LARGE'));
    next(err);
  },
];

async function loadParty(partyId: string) {
  return prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      cancelledAt: true,
      booth: { select: { enabled: true, config: true, updatedAt: true } },
    },
  });
}

type PartyWithBooth = NonNullable<Awaited<ReturnType<typeof loadParty>>>;

async function shape(party: PartyWithBooth, canEdit: boolean) {
  const globalEnabled = await isBoothGloballyOn();
  const hostEnabled = party.booth?.enabled ?? true;
  return {
    enabled: globalEnabled && hostEnabled && !party.cancelledAt,
    hostEnabled,
    globalEnabled,
    config: party.booth?.config ?? null,
    updatedAt: party.booth?.updatedAt ? party.booth.updatedAt.toISOString() : null,
    canEdit,
  };
}

router.get('/:partyId/booth', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');
    const party = await loadParty(partyId);
    if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const authed = !!req.headers.authorization;
    let canEdit = false;
    if (authed && req.userId) {
      canEdit =
        (await canUserEditParty(partyId, req.userId, req.userEmail)) &&
        (await canUserAccessTab(partyId, req.userEmail, req.userId, 'booth'));
    }
    res.set('Cache-Control', authed ? 'private, no-store' : 'public, max-age=60');
    res.json(await shape(party, canEdit));
  } catch (error) {
    next(error);
  }
});

router.put('/:partyId/booth', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const allowed =
      (await canUserEditParty(partyId, req.userId, req.userEmail)) &&
      (await canUserAccessTab(partyId, req.userEmail, req.userId, 'booth'));
    if (!allowed) throw new AppError('Not allowed to edit this party', 403, 'FORBIDDEN');

    const party = await loadParty(partyId);
    if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');
    if (party.cancelledAt) throw new AppError('This event was cancelled', 410, 'EVENT_CANCELLED');

    const body = (req.body ?? {}) as { enabled?: unknown; config?: unknown };
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw new AppError('enabled must be a boolean', 400, 'INVALID_ENABLED');
    }

    let config: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (body.config === null) {
      config = Prisma.DbNull;
    } else if (body.config !== undefined) {
      const result = sanitizeBoothConfig(body.config);
      if (!result.ok) {
        throw new AppError(result.message, result.status, result.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_CONFIG');
      }
      config = result.config as Prisma.InputJsonValue;
    }

    const row = await prisma.partyBooth.upsert({
      where: { partyId },
      create: {
        partyId,
        enabled: body.enabled ?? true,
        ...(config !== undefined ? { config } : {}),
        updatedBy: req.userId ?? null,
      },
      update: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(config !== undefined ? { config } : {}),
        updatedBy: req.userId ?? null,
      },
      select: { enabled: true, config: true, updatedAt: true },
    });

    res.set('Cache-Control', 'private, no-store');
    res.json(await shape({ ...party, booth: row }, true));
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- global flag (super admin)
export const boothAdminRouter = Router();
boothAdminRouter.use(requireAuth);

async function requireSuperAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isSuperAdmin(req.userEmail))) throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    next();
  } catch (err) {
    next(err);
  }
}

boothAdminRouter.get('/settings', requireSuperAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await readSettings([BOOTH_ENABLED_SETTING]);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      key: BOOTH_ENABLED_SETTING.key,
      value: snap.values[BOOTH_ENABLED_SETTING.key].value,
      source: snap.values[BOOTH_ENABLED_SETTING.key].source,
      readFailed: snap.readFailed,
    });
  } catch (err) {
    next(err);
  }
});

boothAdminRouter.put('/settings', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { value, note } = (req.body ?? {}) as { value?: unknown; note?: unknown };
    const noteStr = typeof note === 'string' ? note.trim().slice(0, 500) : null;
    const snap = await readSettings([BOOTH_ENABLED_SETTING]);
    if (snap.readFailed) throw new AppError('Could not read the current value; try again', 503, 'READ_FAILED');
    const current = snap.values[BOOTH_ENABLED_SETTING.key].value;
    const check = checkSettingChange(BOOTH_ENABLED_SETTING, current, value, noteStr);
    if (!check.ok) throw new AppError(check.message, 400, check.code);
    if (value === current) return res.json({ ok: true, unchanged: true, value: current });
    await writeSetting(BOOTH_ENABLED_SETTING, value as number, req.userEmail ?? 'unknown', noteStr || null);
    res.json({ ok: true, value });
  } catch (err) {
    next(err);
  }
});

export default router;
