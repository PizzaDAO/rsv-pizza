/**
 * Admin event-series management (white-label Phase 3 backend). Super-admin gated.
 * Lets an operator create/edit a brand's event series and manage that series'
 * host-checklist defaults. Uses the service-role Prisma client (event_series is
 * RLS-locked to the backend). Public reads go through /api/series (series.routes).
 *
 *   GET    /api/admin/series                       List all series (incl. inactive)
 *   POST   /api/admin/series                       Create a series
 *   PATCH  /api/admin/series/:id                   Update a series
 *   GET    /api/admin/series/:id/checklist         List the series' checklist defaults
 *   POST   /api/admin/series/:id/checklist         Add a checklist default to the series
 *   PATCH  /api/admin/series/checklist/:defaultId  Update a series checklist default
 *   DELETE /api/admin/series/checklist/:defaultId  Delete a series checklist default
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

async function requireSuperAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (e) {
    next(e);
  }
}
router.use(requireSuperAdmin);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim());
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

// ---------- series CRUD ----------

router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const series = await prisma.eventSeries.findMany({ orderBy: [{ createdAt: 'asc' }] });
    res.json({ series });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const slug = str(b.slug)?.toLowerCase();
    const name = str(b.name);
    const displayName = str(b.displayName) ?? name;
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      throw new AppError('slug is required (lowercase letters, digits, dashes)', 400, 'VALIDATION_ERROR');
    }
    if (!name) throw new AppError('name is required', 400, 'VALIDATION_ERROR');

    const series = await prisma.eventSeries.create({
      data: {
        slug,
        name,
        displayName: displayName!,
        isActive: bool(b.isActive) ?? true,
        themeClass: str(b.themeClass) ?? null,
        logoUrl: str(b.logoUrl) ?? null,
        ogImageUrl: str(b.ogImageUrl) ?? null,
        description: str(b.description) ?? null,
        eventType: str(b.eventType) ?? null,
        publicTags: strArr(b.publicTags) ?? [],
        internalTags: strArr(b.internalTags) ?? [],
        requireApproval: bool(b.requireApproval) ?? true,
        hideGuests: bool(b.hideGuests) ?? false,
        photosEnabled: bool(b.photosEnabled) ?? true,
        photosPublic: bool(b.photosPublic) ?? true,
        eventStartTime: str(b.eventStartTime) ?? null,
        eventEndTime: str(b.eventEndTime) ?? null,
        eventDate: b.eventDate ? new Date(b.eventDate as string) : null,
      },
    });
    res.status(201).json({ series });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('A series with that slug already exists', 400, 'DUPLICATE'));
    }
    next(error);
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const data: Prisma.EventSeriesUpdateInput = {};
    if (b.name !== undefined) data.name = str(b.name);
    if (b.displayName !== undefined) data.displayName = str(b.displayName);
    if (b.isActive !== undefined) data.isActive = bool(b.isActive);
    if (b.themeClass !== undefined) data.themeClass = str(b.themeClass) ?? null;
    if (b.logoUrl !== undefined) data.logoUrl = str(b.logoUrl) ?? null;
    if (b.ogImageUrl !== undefined) data.ogImageUrl = str(b.ogImageUrl) ?? null;
    if (b.description !== undefined) data.description = str(b.description) ?? null;
    if (b.eventType !== undefined) data.eventType = str(b.eventType) ?? null;
    if (b.publicTags !== undefined) data.publicTags = strArr(b.publicTags) ?? [];
    if (b.internalTags !== undefined) data.internalTags = strArr(b.internalTags) ?? [];
    if (b.requireApproval !== undefined) data.requireApproval = bool(b.requireApproval);
    if (b.hideGuests !== undefined) data.hideGuests = bool(b.hideGuests);
    if (b.photosEnabled !== undefined) data.photosEnabled = bool(b.photosEnabled);
    if (b.photosPublic !== undefined) data.photosPublic = bool(b.photosPublic);
    if (b.eventStartTime !== undefined) data.eventStartTime = str(b.eventStartTime) ?? null;
    if (b.eventEndTime !== undefined) data.eventEndTime = str(b.eventEndTime) ?? null;
    if (b.eventDate !== undefined) data.eventDate = b.eventDate ? new Date(b.eventDate as string) : null;

    const series = await prisma.eventSeries.update({ where: { id: req.params.id }, data });
    res.json({ series });
  } catch (error: any) {
    if (error?.code === 'P2025') return next(new AppError('Series not found', 404, 'NOT_FOUND'));
    next(error);
  }
});

// ---------- series checklist defaults ----------

router.get('/:id/checklist', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.checklistDefault.findMany({
      where: { seriesId: req.params.id },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/checklist', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const seriesId = req.params.id;
    const series = await prisma.eventSeries.findUnique({ where: { id: seriesId }, select: { id: true } });
    if (!series) throw new AppError('Series not found', 404, 'NOT_FOUND');

    const b = (req.body || {}) as Record<string, unknown>;
    const name = str(b.name);
    if (!name) throw new AppError('name is required', 400, 'VALIDATION_ERROR');

    const max = await prisma.checklistDefault.aggregate({
      where: { seriesId },
      _max: { sortOrder: true },
    });

    const item = await prisma.checklistDefault.create({
      data: {
        seriesId,
        name,
        dueDate: b.dueDate ? new Date(`${b.dueDate as string}T00:00:00.000Z`) : null,
        isAuto: bool(b.isAuto) ?? false,
        autoRule: str(b.autoRule) ?? null,
        linkTab: str(b.linkTab) ?? null,
        sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : (max._max.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json({ item });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('That checklist item name already exists for this series', 400, 'DUPLICATE'));
    }
    next(error);
  }
});

router.patch('/checklist/:defaultId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const data: Prisma.ChecklistDefaultUpdateInput = {};
    if (b.name !== undefined) data.name = str(b.name);
    if (b.dueDate !== undefined) data.dueDate = b.dueDate ? new Date(`${b.dueDate as string}T00:00:00.000Z`) : null;
    if (b.isAuto !== undefined) data.isAuto = bool(b.isAuto);
    if (b.autoRule !== undefined) data.autoRule = str(b.autoRule) ?? null;
    if (b.linkTab !== undefined) data.linkTab = str(b.linkTab) ?? null;
    if (b.sortOrder !== undefined && typeof b.sortOrder === 'number') data.sortOrder = b.sortOrder;

    const item = await prisma.checklistDefault.update({ where: { id: req.params.defaultId }, data });
    res.json({ item });
  } catch (error: any) {
    if (error?.code === 'P2025') return next(new AppError('Checklist default not found', 404, 'NOT_FOUND'));
    next(error);
  }
});

router.delete('/checklist/:defaultId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Only series-scoped defaults are deletable here (never the global template).
    const existing = await prisma.checklistDefault.findUnique({
      where: { id: req.params.defaultId },
      select: { seriesId: true },
    });
    if (!existing) throw new AppError('Checklist default not found', 404, 'NOT_FOUND');
    if (!existing.seriesId) {
      throw new AppError('Refusing to delete a global default here (use the global editor)', 400, 'VALIDATION_ERROR');
    }
    await prisma.checklistDefault.delete({ where: { id: req.params.defaultId } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
