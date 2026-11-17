/**
 * Admin event-series management (white-label Phase 3 backend). Super-admin gated.
 * Lets an operator create/edit a brand's event series and manage that series'
 * host-checklist defaults. Uses the service-role Prisma client (event_series is
 * RLS-locked to the backend). Public reads go through /api/series (series.routes).
 *
 *   GET    /api/admin/series                       List all series (incl. inactive)
 *   POST   /api/admin/series                       Create a series
 *   PATCH  /api/admin/series/:id                   Update a series
 * Every create/update also writes a `series_audit` row (actor, changed fields, pre-change snapshot).
 * `emailDomainVerifiedAt` / `resendDomainId` are server-written: they are never read from a request body.
 *
 *   GET    /api/admin/series/:id/checklist         List the series' checklist defaults
 *   POST   /api/admin/series/:id/checklist         Add a checklist default to the series
 *   PATCH  /api/admin/series/checklist/:defaultId  Update a series checklist default
 *   DELETE /api/admin/series/checklist/:defaultId  Delete a series checklist default
 *   GET    /api/admin/series/:id/events?status=pending  List the series' events by underboss status
 *   PATCH  /api/admin/series/:id/events/:partyId/status  Approve/reject/hide a series event
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { writeStatusAudit } from '../helpers/statusAudit.js';
import { CREATE_FLOW_KEYS, isCreateFlowKey } from '../lib/createPresets.js';
import { isValidSeriesLinkTab } from '../lib/checklistLinkTabs.js';
import { emailHostOfStatusChange } from '../services/partyStatusEmailNotify.js';
import {
  emailOrNull, hostnameOrNull, senderNameOrNull, siteAliasesOrNull, assertSenderConsistent,
} from '../lib/seriesEmailFields.js';
import { writeSeriesAudit, diffSeries, snapshotOf } from '../lib/seriesAudit.js';

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
/** https origin only (no path/query/hash), normalised to `https://host[:port]`; null if absent. */
function siteUrlOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { throw new AppError('siteUrl must be a valid URL', 400, 'VALIDATION_ERROR'); }
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password || s.replace(/\/$/, '') !== u.origin) {
    throw new AppError('siteUrl must be an https origin with no path (e.g. https://events.example.com)', 400, 'VALIDATION_ERROR');
  }
  return u.origin;
}
/** Alias origin: same https-origin rule as siteUrl, but case-insensitive (hosts are lowercased). */
function aliasOrigin(v: unknown): string | null {
  return siteUrlOrNull(typeof v === 'string' ? v.toLowerCase() : v);
}
/** create_flow: one of the preset keys, or null (generic flow). Anything else is a 400. */
function createFlowOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (!isCreateFlowKey(s)) {
    throw new AppError(`createFlow must be one of: ${CREATE_FLOW_KEYS.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  return s;
}
/** 'HH:MM' (00:00-23:59) or null. */
function hmOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new AppError('Times must be HH:MM (24-hour)', 400, 'VALIDATION_ERROR');
  return s;
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

    const siteUrl = siteUrlOrNull(b.siteUrl);
    const emailFromAddress = emailOrNull(b.emailFromAddress, 'emailFromAddress');
    const emailDomain = hostnameOrNull(b.emailDomain, 'emailDomain');
    assertSenderConsistent(emailFromAddress, emailDomain);
    const siteAliases = b.siteAliases === undefined ? [] : siteAliasesOrNull(b.siteAliases, aliasOrigin, siteUrl);

    const series = await prisma.$transaction(async (tx) => {
     const created = await tx.eventSeries.create({
      data: {
        slug,
        name,
        displayName: displayName!,
        isActive: bool(b.isActive) ?? true,
        themeClass: str(b.themeClass) ?? null,
        logoUrl: str(b.logoUrl) ?? null,
        ogImageUrl: str(b.ogImageUrl) ?? null,
        flyerTemplateKey: str(b.flyerTemplateKey) ?? null,
        siteUrl,
        siteAliases,
        emailFromAddress,
        emailFromName: senderNameOrNull(b.emailFromName),
        emailReplyTo: emailOrNull(b.emailReplyTo, 'emailReplyTo'),
        emailDomain,
        // emailDomainVerifiedAt stays null: only the server-side Resend verification may set it.
        brandName: str(b.brandName) ?? null,
        createFlow: createFlowOrNull(b.createFlow),
        nameTemplate: str(b.nameTemplate) ?? null,
        description: str(b.description) ?? null,
        eventType: str(b.eventType) ?? null,
        publicTags: strArr(b.publicTags) ?? [],
        internalTags: strArr(b.internalTags) ?? [],
        requireApproval: bool(b.requireApproval) ?? true,
        hideGuests: bool(b.hideGuests) ?? false,
        photosEnabled: bool(b.photosEnabled) ?? true,
        photosPublic: bool(b.photosPublic) ?? true,
        eventStartTime: hmOrNull(b.eventStartTime),
        eventEndTime: hmOrNull(b.eventEndTime),
        eventDate: b.eventDate ? new Date(b.eventDate as string) : null,
        fundingWalletAddress: str(b.fundingWalletAddress) ?? null,
      },
     });
     await writeSeriesAudit(tx, {
       seriesId: created.id,
       actorEmail: req.userEmail || 'unknown',
       actorKind: 'super_admin',
       action: 'series.create',
       changes: Object.fromEntries(Object.entries(snapshotOf(created as any)).map(([k, v]) => [k, { old: null, new: v }])),
     });
     return created;
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
    if (b.flyerTemplateKey !== undefined) data.flyerTemplateKey = str(b.flyerTemplateKey) ?? null;
    const before = await prisma.eventSeries.findUnique({ where: { id: req.params.id } });
    if (!before) throw new AppError('Series not found', 404, 'NOT_FOUND');
    if (b.siteUrl !== undefined) data.siteUrl = siteUrlOrNull(b.siteUrl);
    if (b.brandName !== undefined) data.brandName = str(b.brandName) ?? null;
    if (b.createFlow !== undefined) data.createFlow = createFlowOrNull(b.createFlow);
    if (b.nameTemplate !== undefined) data.nameTemplate = str(b.nameTemplate) ?? null;
    if (b.description !== undefined) data.description = str(b.description) ?? null;
    if (b.eventType !== undefined) data.eventType = str(b.eventType) ?? null;
    if (b.publicTags !== undefined) data.publicTags = strArr(b.publicTags) ?? [];
    if (b.internalTags !== undefined) data.internalTags = strArr(b.internalTags) ?? [];
    if (b.requireApproval !== undefined) data.requireApproval = bool(b.requireApproval);
    if (b.hideGuests !== undefined) data.hideGuests = bool(b.hideGuests);
    if (b.photosEnabled !== undefined) data.photosEnabled = bool(b.photosEnabled);
    if (b.photosPublic !== undefined) data.photosPublic = bool(b.photosPublic);
    if (b.eventStartTime !== undefined) data.eventStartTime = hmOrNull(b.eventStartTime);
    if (b.eventEndTime !== undefined) data.eventEndTime = hmOrNull(b.eventEndTime);
    if (b.eventDate !== undefined) data.eventDate = b.eventDate ? new Date(b.eventDate as string) : null;
    if (b.fundingWalletAddress !== undefined) data.fundingWalletAddress = str(b.fundingWalletAddress) ?? null;

    // Sender / custom-domain fields. emailDomainVerifiedAt and resendDomainId are NOT accepted here.
    const effectiveSiteUrl = data.siteUrl !== undefined ? (data.siteUrl as string | null) : before.siteUrl;
    if (b.siteAliases !== undefined) data.siteAliases = siteAliasesOrNull(b.siteAliases, aliasOrigin, effectiveSiteUrl);
    if (b.emailFromName !== undefined) data.emailFromName = senderNameOrNull(b.emailFromName);
    if (b.emailReplyTo !== undefined) data.emailReplyTo = emailOrNull(b.emailReplyTo, 'emailReplyTo');
    if (b.emailFromAddress !== undefined) data.emailFromAddress = emailOrNull(b.emailFromAddress, 'emailFromAddress');
    if (b.emailDomain !== undefined) data.emailDomain = hostnameOrNull(b.emailDomain, 'emailDomain');
    const senderChanged =
      (data.emailFromAddress !== undefined && data.emailFromAddress !== before.emailFromAddress) ||
      (data.emailDomain !== undefined && data.emailDomain !== before.emailDomain);
    if (senderChanged) {
      assertSenderConsistent(
        data.emailFromAddress !== undefined ? (data.emailFromAddress as string | null) : before.emailFromAddress,
        data.emailDomain !== undefined ? (data.emailDomain as string | null) : before.emailDomain,
      );
      // A new sender must be re-verified with Resend; until then mail keeps going from rsv.pizza.
      data.emailDomainVerifiedAt = null;
    }
    data.configVersion = { increment: 1 };

    const series = await prisma.$transaction(async (tx) => {
      const updated = await tx.eventSeries.update({ where: { id: req.params.id }, data });
      await writeSeriesAudit(tx, {
        seriesId: updated.id,
        actorEmail: req.userEmail || 'unknown',
        actorKind: 'super_admin',
        action: 'settings.update',
        changes: diffSeries(before as any, updated as any),
        snapshot: snapshotOf(before as any),
      });
      return updated;
    });
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
    if (!isValidSeriesLinkTab(b.linkTab)) throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');

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
    // Same allow-list as the GPP defaults route (+ the checklist modal sentinels).
    if (b.linkTab !== undefined && !isValidSeriesLinkTab(b.linkTab)) {
      throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');
    }
    const data: Prisma.ChecklistDefaultUpdateInput = {};
    if (b.name !== undefined) data.name = str(b.name);
    if (b.dueDate !== undefined) data.dueDate = b.dueDate ? new Date(`${b.dueDate as string}T00:00:00.000Z`) : null;
    if (b.isAuto !== undefined) data.isAuto = bool(b.isAuto);
    if (b.autoRule !== undefined) data.autoRule = str(b.autoRule) ?? null;
    if (b.linkTab !== undefined) data.linkTab = str(b.linkTab) ?? null;
    if (b.sortOrder !== undefined && typeof b.sortOrder === 'number') data.sortOrder = b.sortOrder;

    const before = await prisma.checklistDefault.findUnique({
      where: { id: req.params.defaultId },
      select: { name: true, seriesId: true },
    });
    const item = await prisma.checklistDefault.update({ where: { id: req.params.defaultId }, data });

    // brand-checklists: like the GPP defaults PATCH, propagate due-date / link
    // changes to the already-seeded default items of this series' parties.
    let propagated = 0;
    if (before?.seriesId && (data.dueDate !== undefined || data.linkTab !== undefined)) {
      const itemData: Prisma.ChecklistItemUpdateManyMutationInput = {};
      if (data.dueDate !== undefined) itemData.dueDate = data.dueDate as Date | null;
      if (data.linkTab !== undefined) itemData.linkTab = data.linkTab as string | null;
      const result = await prisma.checklistItem.updateMany({
        where: { isDefault: true, name: before.name, party: { eventSeriesId: before.seriesId } },
        data: itemData,
      });
      propagated = result.count;
    }
    res.json({ item, propagated });
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

// ---------- event approval (brand series need admin approval before public listing) ----------

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'listed', 'hidden'];

router.get('/:id/events', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = str(req.query.status) ?? 'pending';
    if (!APPROVAL_STATUSES.includes(status)) {
      throw new AppError(`status must be one of: ${APPROVAL_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    const events = await prisma.party.findMany({
      where: { eventSeriesId: req.params.id, underbossStatus: status, cancelledAt: null },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, name: true, customUrl: true, inviteCode: true, city: true, country: true,
        date: true, venueName: true, address: true, underbossStatus: true, createdAt: true,
        user: { select: { email: true, name: true } },
      },
      take: 500,
    });
    res.json({ events });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/events/:partyId/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, partyId } = req.params;
    const status = (req.body || {}).status;
    if (!['approved', 'rejected', 'hidden'].includes(status)) {
      throw new AppError('status must be one of: approved, rejected, hidden', 400, 'VALIDATION_ERROR');
    }
    const email = req.userEmail || 'unknown';
    let priorStatus: string | null = null;
    const party = await prisma.$transaction(async (tx) => {
      const before = await tx.party.findUnique({
        where: { id: partyId },
        select: { eventSeriesId: true, underbossStatus: true },
      });
      if (!before || before.eventSeriesId !== id) {
        throw new AppError('Party not found in this series', 404, 'NOT_FOUND');
      }
      priorStatus = before.underbossStatus;
      const updated = await tx.party.update({
        where: { id: partyId },
        data: { underbossStatus: status },
        select: { id: true, underbossStatus: true },
      });
      await writeStatusAudit(tx, partyId, before.underbossStatus, status, email, 'admin');
      return updated;
    });
    // Same as underboss.routes.ts: tell the host of approve/reject (fire-and-forget, only on a real change).
    if ((status === 'approved' || status === 'rejected') && priorStatus !== status) {
      void emailHostOfStatusChange(partyId, status);
    }
    res.json({ party });
  } catch (error) {
    next(error);
  }
});

export default router;
