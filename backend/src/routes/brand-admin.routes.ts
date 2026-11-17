/**
 * Brand-admin API (plans/wl-self-serve-brands.md §2.1), mounted at /api/brand-admin.
 *
 *   POST  /accept                              Accept an emailed invite as the signed-in user
 *   GET   /me                                  Series the caller administers (all series for a super-admin)
 *
 * Everything below is series-scoped, under `/:seriesId`, behind `requireSeriesAdmin` (404 for any
 * series the caller isn't an admin of). Handlers read the series id ONLY from `req.seriesAdmin`
 * and re-scope every child lookup by it. Every mutation writes a `series_audit` row and is rate
 * limited per user. Brand admins can never touch money, domains, tags, slug, create flow, approval
 * default, other series or global settings (see lib/seriesBrandSettings.ts for the allowlist).
 *
 *   GET   /:seriesId/settings                  Editable fields + read-only context
 *   PATCH /:seriesId/settings                  Update allowlisted fields (400 on any other key)
 *   GET   /:seriesId/audit                     Recent settings changes (brand fields only)
 *   POST  /:seriesId/revert {auditId}          Revert to the state before a settings change
 *   GET   /:seriesId/checklist                 This series' checklist defaults (never the global template)
 *   POST  /:seriesId/checklist                 Add a default
 *   PATCH /:seriesId/checklist/:itemId         Edit a default
 *   DELETE /:seriesId/checklist/:itemId        Delete a default
 *   GET   /:seriesId/events?status=pending     The series' events by approval status
 *   PATCH /:seriesId/events/:partyId/status    Approve / reject / hide (final; super-admins keep a veto)
 *   PATCH /:seriesId/alerts {alertsEnabled}    Own new-event alert toggle
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { acceptSeriesInvite, setSeriesAdminAlerts } from '../lib/seriesAdmins.js';
import { isWellFormedInviteToken } from '../lib/seriesInvites.js';
import {
  reserveInviteAccept, reserveUserBucket, reserveKeyBucket,
  BRAND_ADMIN_UPLOAD_BUCKET, BRAND_ADMIN_UPLOAD_LIMIT, BRAND_ADMIN_ATTACH_BUCKET, BRAND_ADMIN_ATTACH_LIMIT,
  BRAND_ASSET_DAILY_BUCKET, BRAND_ASSET_DAILY_LIMIT,
  BRAND_ADMIN_SETTINGS_BUCKET, BRAND_ADMIN_SETTINGS_LIMIT, BRAND_ADMIN_WRITE_BUCKET, BRAND_ADMIN_WRITE_LIMIT,
} from '../lib/seriesInviteLimit.js';
import { requireSeriesAdmin, UUID_RE, type SeriesAdminRequest } from '../lib/seriesAccess.js';
import {
  BRAND_SETTINGS_SELECT, validateBrandSettings, applyBrandSettings, pickSettings, visibleChanges, revertToAudit,
} from '../lib/seriesBrandSettings.js';
import { invalidateSiteBrandCache } from '../lib/siteBrand.js';
import { isSlot, SLOTS, validateUploadRequest, createAssetUploadUrl, attachBrandAsset, removeBrandAsset } from '../lib/brandAssets.js';
import { writeSeriesAudit } from '../lib/seriesAudit.js';
import { isValidSeriesLinkTab } from '../lib/checklistLinkTabs.js';
import {
  LISTABLE_EVENT_STATUSES, listSeriesEvents, setSeriesEventStatus,
} from '../lib/seriesEventStatus.js';

const router = Router();
const MAX_CHECKLIST_ITEMS = 100;

type Handler = (req: SeriesAdminRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: SeriesAdminRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (e) {
    next(e);
  }
};

/** Per-user hourly write budget; a store outage fails closed. */
function writeLimit(bucket: string, limit: number) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      let ok: boolean;
      try {
        ok = await reserveUserBucket(bucket, req.userId || req.userEmail || 'unknown', limit);
      } catch (err) {
        console.error('[brand-admin] rate store unavailable', err);
        throw new AppError('Please try again shortly', 503, 'UNAVAILABLE');
      }
      if (!ok) throw new AppError('Too many changes. Try again later.', 429, 'RATE_LIMITED');
      next();
    } catch (e) {
      next(e);
    }
  };
}
const settingsLimit = writeLimit(BRAND_ADMIN_SETTINGS_BUCKET, BRAND_ADMIN_SETTINGS_LIMIT);
const writeLimited = writeLimit(BRAND_ADMIN_WRITE_BUCKET, BRAND_ADMIN_WRITE_LIMIT);

const actor = (req: SeriesAdminRequest) => ({
  seriesId: req.seriesAdmin!.seriesId,
  actorEmail: req.seriesAdmin!.email,
  actorKind: req.seriesAdmin!.actorKind,
});

// ---------- unscoped ----------

router.post('/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId || !req.userEmail) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    let allowed: boolean;
    try {
      allowed = await reserveInviteAccept(req.ip, req.userId);
    } catch (err) {
      console.error('[brand-admin/accept] rate store unavailable', err);
      throw new AppError('Please try again shortly', 503, 'UNAVAILABLE');
    }
    if (!allowed) throw new AppError('Too many attempts. Try again later.', 429, 'RATE_LIMITED');

    const token = (req.body || {}).token;
    if (!isWellFormedInviteToken(token)) throw new AppError('This invite link is invalid or has expired', 400, 'INVALID_INVITE');
    const { seriesId } = await acceptSeriesInvite({ token, userId: req.userId, userEmail: req.userEmail });
    res.json({ success: true, seriesId });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = (req.userEmail || '').toLowerCase();
    if (!email) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const select = { id: true, slug: true, name: true, displayName: true, brandName: true, siteUrl: true } as const;
    if (await isSuperAdmin(email)) {
      const all = await prisma.eventSeries.findMany({ where: { isActive: true }, select, orderBy: { createdAt: 'asc' } });
      return res.json({ series: all.map((s) => ({ ...s, actorKind: 'super_admin', role: null, alertsEnabled: null })) });
    }
    const rows = await prisma.seriesAdmin.findMany({
      where: { email, status: 'active', series: { is: { isActive: true } } },
      select: { role: true, alertsEnabled: true, series: { select } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ series: rows.map((r) => ({ ...r.series, actorKind: 'series_admin', role: r.role, alertsEnabled: r.alertsEnabled })) });
  } catch (error) {
    next(error);
  }
});

// ---------- series-scoped: every route below passes requireSeriesAdmin first ----------

const scoped = Router({ mergeParams: true });
scoped.use(requireSeriesAdmin);
// Child ids are uuids too: anything else is a 404 before any query.
for (const name of ['itemId', 'partyId']) {
  scoped.param(name, (_req, _res, next, value) => (UUID_RE.test(String(value)) ? next() : next(new AppError('Not found', 404, 'NOT_FOUND'))));
}
router.use('/:seriesId', requireAuth, scoped);

scoped.get('/settings', wrap(async (req, res) => {
  const row = await prisma.eventSeries.findFirst({ where: { id: req.seriesAdmin!.seriesId }, select: BRAND_SETTINGS_SELECT });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  res.json({ settings: pickSettings(row as any) });
}));

scoped.patch('/settings', settingsLimit, wrap(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Expected a JSON object', 400, 'VALIDATION_ERROR');
  const warnings: string[] = [];
  const data = validateBrandSettings(body as Record<string, unknown>, { strict: true, warnings });
  if (Object.keys(data).length === 0) throw new AppError('Nothing to update', 400, 'VALIDATION_ERROR');
  const result = await applyBrandSettings({ ...actor(req), data, action: 'settings.update' });
  if (result.changed.length) invalidateSiteBrandCache(); // brand name / sender show up in emails within the request, not 60 s later
  res.json(warnings.length ? { ...result, warnings } : result);
}));

scoped.get('/audit', wrap(async (req, res) => {
  const rows = await prisma.seriesAudit.findMany({
    where: { seriesId: req.seriesAdmin!.seriesId, action: { in: ['settings.update', 'revert', 'asset.update', 'asset.remove'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, actorEmail: true, actorKind: true, action: true, changes: true, createdAt: true },
  });
  // Brand-field changes only: super-admin edits to money/domain/tag fields stay invisible here.
  // Fields are named explicitly (never spread the row): the snapshot column holds money/domain fields.
  const history = rows
    .map((r) => ({
      id: r.id, action: r.action,
      // PizzaDAO staff are shown by role, not by email.
      actorEmail: r.actorKind === 'series_admin' ? r.actorEmail : 'PizzaDAO admin', actorKind: r.actorKind,
      changes: visibleChanges(r.changes), createdAt: r.createdAt,
    }))
    .filter((r) => Object.keys(r.changes).length > 0);
  res.json({ history });
}));

scoped.post('/revert', settingsLimit, wrap(async (req, res) => {
  const auditId = (req.body || {}).auditId;
  if (typeof auditId !== 'string' || !UUID_RE.test(auditId)) throw new AppError('Not found', 404, 'NOT_FOUND');
  const result = await revertToAudit({ ...actor(req), auditId });
  if (result.changed.length) invalidateSiteBrandCache();
  res.json(result);
}));

// ----- images (logo, favicon, OG, flyer art): lib/brandAssets.ts -----

const uploadLimit = writeLimit(BRAND_ADMIN_UPLOAD_BUCKET, BRAND_ADMIN_UPLOAD_LIMIT);
const attachLimit = writeLimit(BRAND_ADMIN_ATTACH_BUCKET, BRAND_ADMIN_ATTACH_LIMIT);

/** Per-series daily cap on new uploads, on top of the per-user hourly budget. */
async function seriesDailyCap(seriesId: string) {
  let ok: boolean;
  try {
    ok = await reserveKeyBucket(BRAND_ASSET_DAILY_BUCKET, seriesId, BRAND_ASSET_DAILY_LIMIT, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[brand-admin] rate store unavailable', err);
    throw new AppError('Please try again shortly', 503, 'UNAVAILABLE');
  }
  if (!ok) throw new AppError('This brand has reached its daily upload limit. Try again tomorrow.', 429, 'RATE_LIMITED');
}

scoped.post('/assets/upload-url', uploadLimit, wrap(async (req, res) => {
  const { slot, mimeType, fileSize } = req.body || {};
  const { ext } = validateUploadRequest(slot, mimeType, fileSize);
  await seriesDailyCap(req.seriesAdmin!.seriesId);
  const target = await createAssetUploadUrl(req.seriesAdmin!.seriesId, ext);
  res.json({ ...target, slot });
}));

scoped.post('/assets/attach', attachLimit, wrap(async (req, res) => {
  const { slot, path } = req.body || {};
  if (!isSlot(slot)) throw new AppError(`slot must be one of ${SLOTS.join(', ')}`, 400, 'VALIDATION_ERROR');
  const result = await attachBrandAsset({ ...actor(req), slot, path });
  if (result.changed) invalidateSiteBrandCache();
  res.json(result);
}));

scoped.delete('/assets/:slot', writeLimited, wrap(async (req, res) => {
  const { slot } = req.params;
  if (!isSlot(slot)) throw new AppError('Not found', 404, 'NOT_FOUND');
  const result = await removeBrandAsset({ ...actor(req), slot });
  if (result.changed) invalidateSiteBrandCache();
  res.json(result);
}));

// ----- checklist (series defaults only; never the global template) -----

const CHECKLIST_FIELDS = ['name', 'dueDate', 'linkTab', 'sortOrder'] as const;
const bad = (m: string): never => { throw new AppError(m, 400, 'VALIDATION_ERROR'); };

function checklistData(body: unknown, requireName: boolean): Prisma.ChecklistDefaultUpdateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected a JSON object');
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !(CHECKLIST_FIELDS as readonly string[]).includes(k));
  if (extra.length) bad(`Not editable by brand admins: ${extra.join(', ')}. Editable fields: ${CHECKLIST_FIELDS.join(', ')}`);
  const data: Prisma.ChecklistDefaultUpdateInput = {};
  if (b.name !== undefined || requireName) {
    const n = typeof b.name === 'string' ? b.name.trim() : '';
    if (!n) bad('name is required');
    if (n.length > 120) bad('name must be at most 120 characters');
    if (/[<>\u0000-\u001f\u007f]/.test(n)) bad("name can't contain < > or control characters");
    data.name = n;
  }
  if (b.dueDate !== undefined) {
    if (b.dueDate === null || b.dueDate === '') data.dueDate = null;
    else {
      if (typeof b.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) bad('dueDate must be YYYY-MM-DD');
      const d = new Date(`${b.dueDate as string}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) bad('dueDate must be a valid date');
      data.dueDate = d;
    }
  }
  if (b.linkTab !== undefined) {
    if (!isValidSeriesLinkTab(b.linkTab)) bad('Invalid linkTab value');
    data.linkTab = typeof b.linkTab === 'string' && b.linkTab ? b.linkTab : null;
  }
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder) || (b.sortOrder as number) < 0 || (b.sortOrder as number) > 10000) bad('sortOrder must be an integer 0-10000');
    data.sortOrder = b.sortOrder as number;
  }
  return data;
}

const autoItemForbidden = () => new AppError('Automatic checklist items can only be changed by PizzaDAO', 403, 'FORBIDDEN');
const dupGuard = (e: any) => (e?.code === 'P2002' ? new AppError('That checklist item name already exists', 400, 'DUPLICATE') : e);

scoped.get('/checklist', wrap(async (req, res) => {
  const items = await prisma.checklistDefault.findMany({
    where: { seriesId: req.seriesAdmin!.seriesId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, dueDate: true, linkTab: true, sortOrder: true, isAuto: true },
  });
  res.json({ items });
}));

scoped.post('/checklist', writeLimited, wrap(async (req, res) => {
  const { seriesId } = req.seriesAdmin!;
  const data = checklistData(req.body, true);
  try {
    const item = await prisma.$transaction(async (tx) => {
      const count = await tx.checklistDefault.count({ where: { seriesId } });
      if (count >= MAX_CHECKLIST_ITEMS) throw new AppError(`A series can have at most ${MAX_CHECKLIST_ITEMS} checklist items`, 400, 'VALIDATION_ERROR');
      const max = await tx.checklistDefault.aggregate({ where: { seriesId }, _max: { sortOrder: true } });
      const created = await tx.checklistDefault.create({
        data: {
          seriesId,
          name: data.name as string,
          dueDate: (data.dueDate as Date | null | undefined) ?? null,
          linkTab: (data.linkTab as string | null | undefined) ?? null,
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : (max._max.sortOrder ?? -1) + 1,
        },
        select: { id: true, name: true, dueDate: true, linkTab: true, sortOrder: true, isAuto: true },
      });
      await writeSeriesAudit(tx, {
        ...actor(req), action: 'checklist.create',
        changes: { checklistItem: { old: null, new: { id: created.id, name: created.name } } },
      });
      return created;
    });
    res.status(201).json({ item });
  } catch (e) {
    throw dupGuard(e);
  }
}));

scoped.patch('/checklist/:itemId', writeLimited, wrap(async (req, res) => {
  const { seriesId } = req.seriesAdmin!;
  const { itemId } = req.params;
  const data = checklistData(req.body, false);
  if (Object.keys(data).length === 0) bad('Nothing to update');
  let propagated = 0;
  try {
    const item = await prisma.$transaction(async (tx) => {
      // Scoped lookup: another series' item (or a global default) is a 404.
      const before = await tx.checklistDefault.findFirst({ where: { id: itemId, seriesId }, select: { id: true, name: true, isAuto: true } });
      if (!before) throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
      if (before.isAuto) throw autoItemForbidden();
      const res = await tx.checklistDefault.updateMany({ where: { id: itemId, seriesId }, data: data as Prisma.ChecklistDefaultUpdateManyMutationInput });
      if (res.count !== 1) throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
      const updated = await tx.checklistDefault.findFirst({
        where: { id: itemId, seriesId },
        select: { id: true, name: true, dueDate: true, linkTab: true, sortOrder: true, isAuto: true },
      });
      await writeSeriesAudit(tx, {
        ...actor(req), action: 'checklist.update',
        changes: { checklistItem: { old: { id: before.id, name: before.name }, new: { id: before.id, fields: Object.keys(data) } } },
      });
      if (data.dueDate !== undefined || data.linkTab !== undefined) {
        const itemData: Prisma.ChecklistItemUpdateManyMutationInput = {};
        if (data.dueDate !== undefined) itemData.dueDate = data.dueDate as Date | null;
        if (data.linkTab !== undefined) itemData.linkTab = data.linkTab as string | null;
        const r = await tx.checklistItem.updateMany({
          where: { isDefault: true, name: before.name, party: { eventSeriesId: seriesId } },
          data: itemData,
        });
        propagated = r.count;
      }
      return updated;
    });
    res.json({ item, propagated });
  } catch (e) {
    throw dupGuard(e);
  }
}));

scoped.delete('/checklist/:itemId', writeLimited, wrap(async (req, res) => {
  const { seriesId } = req.seriesAdmin!;
  await prisma.$transaction(async (tx) => {
    const before = await tx.checklistDefault.findFirst({ where: { id: req.params.itemId, seriesId }, select: { id: true, name: true, isAuto: true } });
    if (!before) throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    if (before.isAuto) throw autoItemForbidden();
    const r = await tx.checklistDefault.deleteMany({ where: { id: req.params.itemId, seriesId } });
    if (r.count !== 1) throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    await writeSeriesAudit(tx, {
      ...actor(req), action: 'checklist.delete',
      changes: { checklistItem: { old: { id: before.id, name: before.name }, new: null } },
    });
  });
  res.json({ success: true });
}));

// ----- events -----

scoped.get('/events', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'pending';
  if (!(LISTABLE_EVENT_STATUSES as readonly string[]).includes(status)) {
    throw new AppError(`status must be one of: ${LISTABLE_EVENT_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  res.json({ events: await listSeriesEvents(req.seriesAdmin!.seriesId, status) });
}));

scoped.patch('/events/:partyId/status', writeLimited, wrap(async (req, res) => {
  const party = await setSeriesEventStatus({
    ...actor(req), partyId: req.params.partyId, status: (req.body || {}).status,
  });
  res.json({ party });
}));

// ----- own alert preference -----

scoped.patch('/alerts', writeLimited, wrap(async (req, res) => {
  const v = (req.body || {}).alertsEnabled;
  if (typeof v !== 'boolean') throw new AppError('alertsEnabled must be true or false', 400, 'VALIDATION_ERROR');
  const { seriesId, email, actorKind } = req.seriesAdmin!;
  const admin = await setSeriesAdminAlerts({ seriesId, email, alertsEnabled: v, actorEmail: email, actorKind });
  res.json({ admin });
}));

export default router;
