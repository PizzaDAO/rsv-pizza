import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { setDeleteContext } from '../helpers/auditContext.js';
import { createEmbeddedWalletForGuest } from '../services/privy.service.js';

const router = Router();

// GET /api/admin/me — Check if current user is admin + role
router.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail?.toLowerCase();
    if (!email) {
      return res.json({ isAdmin: false });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.json({ isAdmin: false });
    }

    res.json({
      isAdmin: true,
      role: admin.role,
      email: admin.email,
      name: admin.name,
      id: admin.id,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/list — List all admins (any admin can view)
router.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const admins = await prisma.admin.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.json({ admins });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/add — Add admin (super_admin only)
router.post('/add', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { email, name, role } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminRole = role === 'super_admin' ? 'super_admin' : 'admin';

    const existing = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AppError('Admin with this email already exists', 400, 'DUPLICATE');
    }

    const admin = await prisma.admin.create({
      data: {
        email: normalizedEmail,
        role: adminRole,
        name: name?.trim() || null,
        createdBy: req.userEmail || null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.status(201).json({ admin });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/:id — Remove admin (super_admin only, can't remove self)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    const admin = await prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new AppError('Admin not found', 404, 'NOT_FOUND');
    }

    if (admin.email === req.userEmail?.toLowerCase()) {
      throw new AppError('Cannot remove yourself', 400, 'SELF_REMOVAL');
    }

    await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, req.userEmail, 'admin');
      await tx.admin.delete({ where: { id } });
    });

    res.json({ success: true, message: 'Admin removed' });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/gpp-nft — Get current GPP NFT settings
router.get('/gpp-nft', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    // Get a sample GPP event to read current settings
    const sample = await prisma.party.findFirst({
      where: { eventType: 'gpp' },
      select: { nftEnabled: true, nftChain: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      nftEnabled: sample?.nftEnabled ?? false,
      nftChain: sample?.nftChain ?? 'base',
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/gpp-nft — Bulk update NFT settings for all GPP events
router.patch('/gpp-nft', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can update GPP NFT settings', 403, 'FORBIDDEN');
    }

    const { nftEnabled, nftChain } = req.body;

    if (typeof nftEnabled !== 'boolean') {
      throw new AppError('nftEnabled must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const result = await prisma.party.updateMany({
      where: { eventType: 'gpp' },
      data: {
        nftEnabled,
        ...(nftChain && { nftChain }),
      },
    });

    res.json({
      success: true,
      updatedCount: result.count,
      nftEnabled,
      nftChain: nftChain || 'base',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Checklist Defaults — using dedicated table
// ============================================

// Allow-list for `link_tab` values. Mirrors the host-page TabType enumeration
// (excluding `dashboard`, `checklist`, `apps`, and null/empty which is "no link").
const ALLOWED_LINK_TABS = [
  'details', 'venue', 'pizza', 'guests', 'photos', 'partners', 'music',
  'report', 'staff', 'displays', 'raffle', 'budget', 'gpp', 'promo',
  'flyer', 'print',
];

function isValidLinkTab(v: unknown): v is string | null {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  if (v === '') return true; // coerced to null upstream
  return ALLOWED_LINK_TABS.includes(v);
}

// Raw-SQL admin check helpers (bypass Prisma UUID deserialization bug)
async function rawIsAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const result = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM admins WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  return result.length > 0;
}

async function rawIsSuperAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const result = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT role FROM admins WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  return result[0]?.role === 'super_admin';
}

// GET /api/admin/checklist-defaults — Read from checklist_defaults table
router.get('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const items = await prisma.$queryRaw<Array<{
      name: string;
      due_date: Date | null;
      sort_order: number;
      is_auto: boolean;
      auto_rule: string | null;
      link_tab: string | null;
    }>>`
      SELECT name, due_date, sort_order, is_auto, auto_rule, link_tab
      FROM checklist_defaults
      ORDER BY sort_order ASC
    `;

    // Map to camelCase to match existing frontend interface
    const mapped = items.map(i => ({
      name: i.name,
      dueDate: i.due_date ? i.due_date.toISOString().split('T')[0] : null,
      sortOrder: i.sort_order,
      isAuto: i.is_auto,
      autoRule: i.auto_rule,
      linkTab: i.link_tab,
    }));

    res.json({ items: mapped });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/checklist-defaults — Update defaults + propagate to all GPP events
router.patch('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can update checklist defaults', 403, 'FORBIDDEN');
    }

    const { items } = req.body;
    if (!Array.isArray(items)) {
      throw new AppError('items must be an array', 400, 'VALIDATION_ERROR');
    }

    // Get all GPP party IDs for propagation
    const gppParties = await prisma.party.findMany({
      where: { eventType: 'gpp' },
      select: { id: true },
    });
    const gppPartyIds = gppParties.map(p => p.id);

    let totalUpdated = 0;
    for (const item of items) {
      if (!item.name) continue;

      const hasDueDate = Object.prototype.hasOwnProperty.call(item, 'dueDate');
      const hasLinkTab = Object.prototype.hasOwnProperty.call(item, 'linkTab');

      const parsedDate = item.dueDate ? new Date(item.dueDate + 'T00:00:00.000Z') : null;

      // Validate + coerce linkTab when provided
      let linkTabValue: string | null | undefined;
      if (hasLinkTab) {
        if (!isValidLinkTab(item.linkTab)) {
          throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');
        }
        linkTabValue = item.linkTab === '' ? null : (item.linkTab ?? null);
      }

      if (!hasDueDate && !hasLinkTab) continue;

      // 1. Update the checklist_defaults row
      const defaultData: Record<string, unknown> = {};
      if (hasDueDate) defaultData.dueDate = parsedDate;
      if (hasLinkTab) defaultData.linkTab = linkTabValue;

      await prisma.checklistDefault.updateMany({
        where: { name: item.name },
        data: defaultData,
      });

      // 2. Propagate to all GPP events' checklist_items
      if (gppPartyIds.length > 0) {
        const itemData: Record<string, unknown> = {};
        if (hasDueDate) itemData.dueDate = parsedDate;
        if (hasLinkTab) itemData.linkTab = linkTabValue;

        const result = await prisma.checklistItem.updateMany({
          where: {
            partyId: { in: gppPartyIds },
            isDefault: true,
            name: item.name,
          },
          data: itemData,
        });
        totalUpdated += result.count;
      }
    }

    res.json({ success: true, totalUpdated });
  } catch (error: any) {
    console.error('[checklist-defaults PATCH]', error);
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: { message: error.message, code: error.code },
      });
    }
    res.status(500).json({
      error: {
        message: String(error?.message || error),
        name: error?.name,
        code: error?.code,
        meta: error?.meta,
      },
    });
  }
});

// DELETE /api/admin/checklist-defaults/:name — Remove a checklist default + propagate to all GPP events
router.delete('/checklist-defaults/:name', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can remove checklist items', 403, 'FORBIDDEN');
    }

    const itemName = decodeURIComponent(req.params.name);

    // 1. Delete from checklist_defaults
    const deleted = await prisma.$executeRaw`
      DELETE FROM checklist_defaults WHERE name = ${itemName}
    `;

    if (deleted === 0) {
      throw new AppError('Item not found', 404, 'NOT_FOUND');
    }

    // 2. Delete from all GPP events' checklist_items
    const totalDeleted = await prisma.$executeRaw`
      DELETE FROM checklist_items ci
      USING parties p
      WHERE ci.party_id = p.id
        AND p.event_type = 'gpp'
        AND ci.is_default = true
        AND ci.name = ${itemName}
    `;

    res.json({ success: true, totalDeleted });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/checklist-defaults — Add new item to defaults + all GPP events
router.post('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can add checklist items', 403, 'FORBIDDEN');
    }

    const { name, dueDate, linkTab } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    if (!isValidLinkTab(linkTab)) {
      throw new AppError('Invalid linkTab value', 400, 'VALIDATION_ERROR');
    }

    const trimmedName = name.trim();
    const parsedDate = dueDate ? new Date(dueDate + 'T00:00:00.000Z') : null;
    const linkTabValue: string | null = linkTab === '' || linkTab == null ? null : linkTab;

    // Get next sort_order
    const existing = await prisma.checklistDefault.findMany({
      orderBy: { sortOrder: 'desc' },
      take: 1,
      select: { sortOrder: true },
    });
    const nextSort = (existing[0]?.sortOrder ?? -1) + 1;

    // 1. Insert into checklist_defaults
    await prisma.checklistDefault.create({
      data: {
        name: trimmedName,
        dueDate: parsedDate,
        isAuto: false,
        sortOrder: nextSort,
        linkTab: linkTabValue,
      },
    });

    // 2. Insert into all GPP events' checklist_items
    const gppParties = await prisma.party.findMany({
      where: { eventType: 'gpp' },
      select: { id: true },
    });

    if (gppParties.length > 0) {
      await prisma.checklistItem.createMany({
        data: gppParties.map(p => ({
          partyId: p.id,
          name: trimmedName,
          dueDate: parsedDate,
          isAuto: false,
          isDefault: true,
          sortOrder: nextSort,
          linkTab: linkTabValue,
        })),
      });
    }

    res.status(201).json({ success: true, createdCount: gppParties.length });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: { message: 'An item with that name already exists', code: 'DUPLICATE' } });
    }
    next(error);
  }
});

// ============================================
// GPP Default Description
// ============================================

const GPP_HARDCODED_DESCRIPTION = `Join us for the Global Pizza Party, a worldwide celebration of pizza and bitcoin, where communities around the world come together to share pizza and good vibes.

What to expect:
- Free pizza
- Crypto enthusiasts
- Good conversations

RSVP to secure your slice!`;

// GET /api/admin/gpp-description — Read current default + event stats
router.get('/gpp-description', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    // Read current default from app_config
    const configRow = await prisma.appConfig.findUnique({ where: { key: 'gpp_default_description' } });
    const defaultDescription = configRow?.value ?? GPP_HARDCODED_DESCRIPTION;

    // Count all GPP events
    const totalGppEvents = await prisma.party.count({ where: { eventType: 'gpp' } });

    // Count events still on default
    const defaultCount = await prisma.party.count({
      where: { eventType: 'gpp', description: defaultDescription },
    });

    // Find events with custom descriptions
    const customEvents = await prisma.party.findMany({
      where: {
        eventType: 'gpp',
        NOT: { description: defaultDescription },
      },
      select: {
        id: true,
        name: true,
        customUrl: true,
        inviteCode: true,
        description: true,
      },
      orderBy: { name: 'asc' },
    });

    const customizedEvents = customEvents.map(e => ({
      id: e.id,
      name: e.name,
      customUrl: e.customUrl,
      inviteCode: e.inviteCode,
      descriptionPreview: (e.description || '').slice(0, 100),
    }));

    res.json({ defaultDescription, totalGppEvents, defaultCount, customizedEvents });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/gpp-description — Update default + bulk-apply to events on old default
router.patch('/gpp-description', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { description } = req.body;
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new AppError('description is required', 400, 'VALIDATION_ERROR');
    }

    const newDescription = description.trim();

    // Read old default
    const configRow = await prisma.appConfig.findUnique({ where: { key: 'gpp_default_description' } });
    const oldDefault = configRow?.value ?? GPP_HARDCODED_DESCRIPTION;

    // Upsert the new default
    await prisma.appConfig.upsert({
      where: { key: 'gpp_default_description' },
      update: { value: newDescription, updatedAt: new Date() },
      create: { key: 'gpp_default_description', value: newDescription },
    });

    // Bulk-update events that still have the old default
    const result = await prisma.party.updateMany({
      where: { eventType: 'gpp', description: oldDefault },
      data: { description: newDescription },
    });

    const totalGppEvents = await prisma.party.count({ where: { eventType: 'gpp' } });
    const skippedCount = totalGppEvents - result.count;

    res.json({
      success: true,
      updatedCount: result.count,
      skippedCount,
      newDefault: newDescription,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Privy Wallet Backfill
// ============================================

/**
 * POST /api/admin/provision-wallets
 *
 * Provisions Privy embedded wallets for all existing guests who have an email
 * but no wallet address. Processes in batches of 10 with a 200ms delay between
 * individual calls and a 1s pause between batches to respect Privy rate limits.
 *
 * Auth: requires x-admin-secret header matching ADMIN_SECRET env var.
 *
 * Returns: { total, provisioned, failed, skipped, errors }
 */
router.post('/provision-wallets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Auth check: require ADMIN_SECRET header
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(500).json({ error: 'ADMIN_SECRET not configured on server' });
    }
    if (req.headers['x-admin-secret'] !== adminSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find all guests with an email but no wallet address
    const guests = await prisma.guest.findMany({
      where: {
        ethereumAddress: null,
        email: { not: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { submittedAt: 'asc' },
    });

    const total = guests.length;
    let provisioned = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ guestId: string; email: string; error: string }> = [];

    console.log(`[provision-wallets] Starting backfill for ${total} guests without wallets`);

    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_CALLS_MS = 200;
    const DELAY_BETWEEN_BATCHES_MS = 1000;

    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(guests.length / BATCH_SIZE);

      console.log(`[provision-wallets] Processing batch ${batchNum}/${totalBatches} (${batch.length} guests)`);

      for (const guest of batch) {
        if (!guest.email) {
          skipped++;
          continue;
        }

        // Double-check the guest still has no wallet (idempotency)
        const current = await prisma.guest.findUnique({
          where: { id: guest.id },
          select: { ethereumAddress: true },
        });
        if (current?.ethereumAddress) {
          skipped++;
          console.log(`[provision-wallets] Skipping guest ${guest.id} — already has wallet`);
          continue;
        }

        try {
          const walletResult = await createEmbeddedWalletForGuest(guest.email, guest.name);
          if (walletResult) {
            await prisma.guest.update({
              where: { id: guest.id },
              data: {
                ethereumAddress: walletResult.walletAddress,
                privyUserId: walletResult.privyUserId,
                walletSource: 'privy-embedded',
              },
            });
            provisioned++;
            console.log(`[provision-wallets] Provisioned wallet for guest ${guest.id}: ${walletResult.walletAddress}`);
          } else {
            skipped++;
            console.log(`[provision-wallets] Privy returned null for guest ${guest.id} (${guest.email}), skipped`);
          }
        } catch (err: any) {
          failed++;
          const errorMsg = err?.message || String(err);
          errors.push({ guestId: guest.id, email: guest.email, error: errorMsg });
          console.error(`[provision-wallets] Failed for guest ${guest.id} (${guest.email}):`, errorMsg);
        }

        // Rate-limit delay between individual calls
        if (DELAY_BETWEEN_CALLS_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
        }
      }

      // Pause between batches (unless this is the last batch)
      if (i + BATCH_SIZE < guests.length && DELAY_BETWEEN_BATCHES_MS > 0) {
        console.log(`[provision-wallets] Pausing ${DELAY_BETWEEN_BATCHES_MS}ms between batches...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    console.log(`[provision-wallets] Complete: ${provisioned} provisioned, ${failed} failed, ${skipped} skipped out of ${total} total`);

    res.json({
      total,
      provisioned,
      failed,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/:id — Update admin role/name (super_admin only, can't downgrade self)
// IMPORTANT: This wildcard route must be LAST to avoid matching named routes like /checklist-defaults, /gpp-description
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { name, role } = req.body;

    const admin = await prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new AppError('Admin not found', 404, 'NOT_FOUND');
    }

    if (admin.email === req.userEmail?.toLowerCase() && role && role !== 'super_admin') {
      throw new AppError('Cannot downgrade your own role', 400, 'SELF_DOWNGRADE');
    }

    const updated = await prisma.admin.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name?.trim() || null }),
        ...(role !== undefined && ['super_admin', 'admin'].includes(role) && { role }),
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.json({ admin: updated });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/funnel-stats — RSVP funnel stats (admin only)
router.get('/funnel-stats', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const events = await prisma.party.findMany({
      where: { eventType: 'gpp' },
      select: { id: true, name: true, address: true },
      orderBy: { createdAt: 'desc' },
    });

    let totalViews = 0;
    let totalOpened = 0;
    let totalStep1 = 0;
    let totalSubmitted = 0;

    const eventStats = await Promise.all(events.map(async (e) => {
      const [viewCount, guestCount, funnelEvents] = await Promise.all([
        prisma.pageView.count({ where: { partyId: e.id } }),
        prisma.guest.count({ where: { partyId: e.id, status: { not: 'INVITED' } } }),
        prisma.rsvpFunnelEvent.findMany({ where: { partyId: e.id }, select: { step: true } }),
      ]);

      const views = viewCount;
      const opened = funnelEvents.filter((f) => f.step === 'rsvp_opened').length;
      const step1Complete = funnelEvents.filter((f) => f.step === 'rsvp_step1_complete').length;
      const submitted = guestCount;

      totalViews += views;
      totalOpened += opened;
      totalStep1 += step1Complete;
      totalSubmitted += submitted;

      return {
        eventId: e.id,
        eventName: e.name,
        city: e.address || '',
        views,
        opened,
        step1Complete,
        submitted,
      };
    }));

    res.json({
      events: eventStats,
      totals: {
        views: totalViews,
        opened: totalOpened,
        step1Complete: totalStep1,
        submitted: totalSubmitted,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
