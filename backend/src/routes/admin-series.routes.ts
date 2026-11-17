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
 *
 * Brand admins (super-admin only here; plans/wl-self-serve-brands.md §2.1):
 *   GET    /api/admin/series/:id/admins                        List brand admins
 *   POST   /api/admin/series/:id/admins {email, role}          Invite (or re-invite a revoked) brand admin
 *   POST   /api/admin/series/:id/admins/:adminId/resend        New invite link for a pending invite
 *   PATCH  /api/admin/series/:id/admins/:adminId {status:'revoked'} | {alertsEnabled}
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { listSeriesEvents, setSeriesEventStatus } from '../lib/seriesEventStatus.js';
import { CREATE_FLOW_KEYS, isCreateFlowKey } from '../lib/createPresets.js';
import { isValidSeriesLinkTab } from '../lib/checklistLinkTabs.js';
import {
  emailOrNull, hostnameOrNull, senderNameOrNull, siteAliasesOrNull, assertSenderConsistent, assertSubdomainHost,
} from '../lib/seriesEmailFields.js';
import { UUID_RE } from '../lib/seriesAccess.js';
import { writeSeriesAudit, diffSeries, snapshotOf } from '../lib/seriesAudit.js';
import { superAdminThemeTokens } from '../lib/seriesBrandSettings.js';
import {
  SERIES_ADMIN_ROLES, listSeriesAdmins, inviteSeriesAdmin, resendSeriesInvite, revokeSeriesAdmin, setSeriesAdminAlerts,
} from '../lib/seriesAdmins.js';

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

// Path ids are uuids: anything else is a 404 before any query (also keeps probes cheap).
for (const name of ['id', 'adminId', 'defaultId', 'partyId']) {
  router.param(name, (_req, _res, next, value) => (UUID_RE.test(String(value)) ? next() : next(new AppError('Not found', 404, 'NOT_FOUND'))));
}

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
/** Alias origin: same https-origin rule as siteUrl, but case-insensitive, and subdomains only. */
function aliasOrigin(v: unknown): string | null {
  const o = siteUrlOrNull(typeof v === 'string' ? v.toLowerCase() : v);
  if (o) assertSubdomainHost(new URL(o).hostname, 'siteAliases');
  return o;
}
/** siteUrl for a partner site must be a subdomain. Unchanged values are exempt so editing other fields never breaks. */
function checkSiteUrlSubdomain(next: string | null, current: string | null): void {
  if (next && next !== current) assertSubdomainHost(new URL(next).hostname, 'siteUrl');
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
    checkSiteUrlSubdomain(siteUrl, null);
    const emailFromAddress = emailOrNull(b.emailFromAddress, 'emailFromAddress');
    const emailDomain = hostnameOrNull(b.emailDomain, 'emailDomain', { subdomainOnly: true });
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
    const warnings: string[] = [];
    // Theme tokens incl. super-admin-only `overrides`; same strict validation as brand admins.
    if (b.themeTokens !== undefined) data.themeTokens = superAdminThemeTokens(b.themeTokens, warnings);
    if (b.name !== undefined) data.name = str(b.name);
    if (b.displayName !== undefined) data.displayName = str(b.displayName);
    if (b.isActive !== undefined) data.isActive = bool(b.isActive);
    if (b.themeClass !== undefined) data.themeClass = str(b.themeClass) ?? null;
    if (b.logoUrl !== undefined) data.logoUrl = str(b.logoUrl) ?? null;
    if (b.ogImageUrl !== undefined) data.ogImageUrl = str(b.ogImageUrl) ?? null;
    if (b.flyerTemplateKey !== undefined) data.flyerTemplateKey = str(b.flyerTemplateKey) ?? null;
    const before = await prisma.eventSeries.findUnique({ where: { id: req.params.id } });
    if (!before) throw new AppError('Series not found', 404, 'NOT_FOUND');
    if (b.siteUrl !== undefined) {
      data.siteUrl = siteUrlOrNull(b.siteUrl);
      checkSiteUrlSubdomain(data.siteUrl as string | null, before.siteUrl);
    }
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
    if (b.emailDomain !== undefined) data.emailDomain = hostnameOrNull(b.emailDomain, 'emailDomain', { subdomainOnly: true });
    const senderChanged =
      (data.emailFromAddress !== undefined && data.emailFromAddress !== before.emailFromAddress) ||
      (data.emailDomain !== undefined && data.emailDomain !== before.emailDomain);
    if (senderChanged) {
      assertSenderConsistent(
        data.emailFromAddress !== undefined ? (data.emailFromAddress as string | null) : before.emailFromAddress,
        data.emailDomain !== undefined ? (data.emailDomain as string | null) : before.emailDomain,
      );
      // A new sender must be re-verified with Resend; until then mail keeps using the default sender.
      data.emailDomainVerifiedAt = null;
    }
    data.configVersion = { increment: 1 };

    const series = await prisma.$transaction(async (tx) => {
      const updated = await tx.eventSeries.update({ where: { id: req.params.id }, data });
      const changes = diffSeries(before as any, updated as any);
      await writeSeriesAudit(tx, {
        seriesId: updated.id,
        actorEmail: req.userEmail || 'unknown',
        actorKind: 'super_admin',
        action: 'settings.update',
        changes,
        snapshot: snapshotOf(before as any),
      });
      // CORS trusts site_url / site_aliases of active series (lib/cors.ts), so every change to them is
      // also logged on its own line for a quick grep, in addition to the series_audit row.
      if (changes.siteUrl || changes.siteAliases || changes.isActive) {
        console.log(
          `[wl-audit] series ${updated.slug} origin change by ${req.userEmail || 'unknown'}: ` +
          JSON.stringify({ siteUrl: changes.siteUrl, siteAliases: changes.siteAliases, isActive: changes.isActive }),
        );
      }
      return updated;
    });
    res.json(warnings.length ? { series, warnings } : { series });
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

/** auto_rule: a short snake_case rule key (e.g. hackathon_prizes_paid), or null. */
function autoRuleOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(s)) {
    throw new AppError('autoRule must be a snake_case rule key (a-z, 0-9, _; max 64)', 400, 'VALIDATION_ERROR');
  }
  return s;
}
/** 'YYYY-MM-DD' -> Date at UTC midnight; null when absent; 400 when malformed. */
function dayOrNull(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError('dueDate must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new AppError('dueDate must be a valid date', 400, 'VALIDATION_ERROR');
  return d;
}

router.post('/:id/checklist', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const seriesId = req.params.id;
    const series = await prisma.eventSeries.findUnique({ where: { id: seriesId }, select: { id: true } });
    if (!series) throw new AppError('Series not found', 404, 'NOT_FOUND');

    const b = (req.body || {}) as Record<string, unknown>;
    const name = str(b.name);
    if (!name) throw new AppError('name is required', 400, 'VALIDATION_ERROR');
    if (!isValidSeriesLinkTab(b.linkTab)) throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');
    const dueDate = dayOrNull(b.dueDate);
    const autoRule = autoRuleOrNull(b.autoRule);

    const item = await prisma.$transaction(async (tx) => {
      const max = await tx.checklistDefault.aggregate({ where: { seriesId }, _max: { sortOrder: true } });
      const created = await tx.checklistDefault.create({
        data: {
          seriesId,
          name,
          dueDate,
          isAuto: bool(b.isAuto) ?? false,
          autoRule,
          linkTab: str(b.linkTab) ?? null,
          sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : (max._max.sortOrder ?? -1) + 1,
        },
      });
      await writeSeriesAudit(tx, {
        seriesId, actorEmail: req.userEmail || 'unknown', actorKind: 'super_admin', action: 'checklist.create',
        changes: { checklistItem: { old: null, new: { id: created.id, name: created.name } } },
      });
      return created;
    });
    res.status(201).json({ item });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('That checklist item name already exists for this series', 400, 'DUPLICATE'));
    }
    next(error);
  }
});

/**
 * Edit / delete a series checklist default. The item is always looked up by `{ id, seriesId }`, so an
 * item of another series, or a global default (series_id null), is a 404 here.
 */
router.patch('/:id/checklist/:defaultId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: seriesId, defaultId } = req.params;
    const b = (req.body || {}) as Record<string, unknown>;
    // Same allow-list as the GPP defaults route (+ the checklist modal sentinels).
    if (b.linkTab !== undefined && !isValidSeriesLinkTab(b.linkTab)) {
      throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');
    }
    const data: Prisma.ChecklistDefaultUpdateInput = {};
    if (b.name !== undefined) data.name = str(b.name);
    if (b.dueDate !== undefined) data.dueDate = dayOrNull(b.dueDate);
    if (b.isAuto !== undefined) data.isAuto = bool(b.isAuto);
    if (b.autoRule !== undefined) data.autoRule = autoRuleOrNull(b.autoRule);
    if (b.linkTab !== undefined) data.linkTab = str(b.linkTab) ?? null;
    if (b.sortOrder !== undefined && typeof b.sortOrder === 'number') data.sortOrder = b.sortOrder;

    let propagated = 0;
    const item = await prisma.$transaction(async (tx) => {
      const before = await tx.checklistDefault.findFirst({ where: { id: defaultId, seriesId }, select: { id: true, name: true } });
      if (!before) throw new AppError('Checklist default not found', 404, 'NOT_FOUND');
      const r = await tx.checklistDefault.updateMany({ where: { id: defaultId, seriesId }, data: data as Prisma.ChecklistDefaultUpdateManyMutationInput });
      if (r.count !== 1) throw new AppError('Checklist default not found', 404, 'NOT_FOUND');
      const updated = await tx.checklistDefault.findFirst({ where: { id: defaultId, seriesId } });
      await writeSeriesAudit(tx, {
        seriesId, actorEmail: req.userEmail || 'unknown', actorKind: 'super_admin', action: 'checklist.update',
        changes: { checklistItem: { old: { id: before.id, name: before.name }, new: { id: before.id, fields: Object.keys(data) } } },
      });
      // brand-checklists: like the GPP defaults PATCH, propagate due-date / link changes to the
      // already-seeded default items of this series' parties.
      if (data.dueDate !== undefined || data.linkTab !== undefined) {
        const itemData: Prisma.ChecklistItemUpdateManyMutationInput = {};
        if (data.dueDate !== undefined) itemData.dueDate = data.dueDate as Date | null;
        if (data.linkTab !== undefined) itemData.linkTab = data.linkTab as string | null;
        const result = await tx.checklistItem.updateMany({
          where: { isDefault: true, name: before.name, party: { eventSeriesId: seriesId } },
          data: itemData,
        });
        propagated = result.count;
      }
      return updated;
    });
    res.json({ item, propagated });
  } catch (error: any) {
    if (error?.code === 'P2002') return next(new AppError('That checklist item name already exists for this series', 400, 'DUPLICATE'));
    next(error);
  }
});

router.delete('/:id/checklist/:defaultId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: seriesId, defaultId } = req.params;
    await prisma.$transaction(async (tx) => {
      const before = await tx.checklistDefault.findFirst({ where: { id: defaultId, seriesId }, select: { id: true, name: true } });
      if (!before) throw new AppError('Checklist default not found', 404, 'NOT_FOUND');
      const r = await tx.checklistDefault.deleteMany({ where: { id: defaultId, seriesId } });
      if (r.count !== 1) throw new AppError('Checklist default not found', 404, 'NOT_FOUND');
      await writeSeriesAudit(tx, {
        seriesId, actorEmail: req.userEmail || 'unknown', actorKind: 'super_admin', action: 'checklist.delete',
        changes: { checklistItem: { old: { id: before.id, name: before.name }, new: null } },
      });
    });
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
    res.json({ events: await listSeriesEvents(req.params.id, status) });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/events/:partyId/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Super-admins keep a veto: no "already decided" lock, they can overrule a brand admin's decision.
    const party = await setSeriesEventStatus({
      seriesId: req.params.id,
      partyId: req.params.partyId,
      status: (req.body || {}).status,
      actorEmail: req.userEmail || 'unknown',
      actorKind: 'super_admin',
    });
    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// ---------- brand admins (super-admin only; the whole router is requireSuperAdmin) ----------

router.get('/:id/admins', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ admins: await listSeriesAdmins(req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/admins', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const email = emailOrNull(b.email, 'email');
    if (!email) throw new AppError('email is required', 400, 'VALIDATION_ERROR');
    const role = b.role === undefined ? 'editor' : str(b.role);
    if (!role || !(SERIES_ADMIN_ROLES as readonly string[]).includes(role)) {
      throw new AppError(`role must be one of: ${SERIES_ADMIN_ROLES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    const result = await inviteSeriesAdmin({ seriesId: req.params.id, email, role, actorEmail: req.userEmail || 'unknown' });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/admins/:adminId/resend', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await resendSeriesInvite({ seriesId: req.params.id, adminId: req.params.adminId, actorEmail: req.userEmail || 'unknown' }));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/admins/:adminId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const actorEmail = req.userEmail || 'unknown';
    if (b.status !== undefined) {
      if (b.status !== 'revoked') throw new AppError("status can only be set to 'revoked' (re-invite to restore)", 400, 'VALIDATION_ERROR');
      return res.json({ admin: await revokeSeriesAdmin({ seriesId: req.params.id, adminId: req.params.adminId, actorEmail }) });
    }
    if (typeof b.alertsEnabled === 'boolean') {
      return res.json({
        admin: await setSeriesAdminAlerts({
          seriesId: req.params.id, adminId: req.params.adminId, alertsEnabled: b.alertsEnabled, actorEmail, actorKind: 'super_admin',
        }),
      });
    }
    throw new AppError('Nothing to update: send status:"revoked" or alertsEnabled', 400, 'VALIDATION_ERROR');
  } catch (error) {
    next(error);
  }
});

export default router;
