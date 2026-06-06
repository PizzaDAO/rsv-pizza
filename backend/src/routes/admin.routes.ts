import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { setDeleteContext } from '../helpers/auditContext.js';
import { createEmbeddedWalletForGuest } from '../services/privy.service.js';
import { getSocialPostConfig, invalidate } from '../lib/privateConfig.js';

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
    // Accepted role values: 'admin' (default), 'super_admin', 'payment_admin'.
    // payment_admin (added arugula-38633 PR 2) gates the host-payments dashboard
    // but is NOT treated as a regular admin elsewhere — see isAdmin() in auth.ts.
    const adminRole =
      role === 'super_admin'
        ? 'super_admin'
        : role === 'payment_admin'
          ? 'payment_admin'
          : 'admin';

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

// GET /api/admin/wallet-addresses.csv — Export DISTINCT wallet addresses across
// all guests (super_admin only). Pushes DISTINCT into SQL per repo guardrail —
// no JS post-filter on a paginated query.
router.get('/wallet-addresses.csv', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const rows = await prisma.$queryRaw<Array<{ ethereum_address: string }>>`
      SELECT DISTINCT ethereum_address
      FROM guests
      WHERE ethereum_address IS NOT NULL
      ORDER BY ethereum_address ASC
    `;

    const csv = 'wallet_address\n' + rows.map(r => r.ethereum_address).join('\n');
    res
      .setHeader('Content-Type', 'text/csv')
      .setHeader('Content-Disposition', 'attachment; filename=all-wallets.csv')
      .send(csv);
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

// ============================================
// GET /api/admin/users/:userId/payment-details — siciliana-69183
//
// Returns a user's saved payment-details for the admin /payments dashboard.
// Surfaced when an admin clicks a host chip / "Submitted by X" caption in the
// prepay queue + payouts table. Gated to admin / super_admin / payment_admin
// only (same role set that can already see the /payments dashboard).
//
// Returns only what the admin needs to verify / route a payment:
// preferred method, wallet address (for usdc_base), bank email (for wire),
// plus a "totalPayouts + latestPayoutAt" context blurb. We intentionally do
// NOT return the full bank-details JSON (routing/account numbers etc.) —
// admins don't need it on this surface (Mercury / wire happen out-of-band).
// ============================================
router.get(
  '/users/:userId/payment-details',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!(await isPaymentAdmin(req.userEmail))) {
        throw new AppError('Payments admin access required', 403, 'FORBIDDEN');
      }

      const userId = req.params.userId?.trim();
      if (!userId) {
        throw new AppError('userId is required', 400, 'VALIDATION_ERROR');
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          preferredPayoutMethod: true,
          payoutWalletAddress: true,
          payoutBankDetails: true,
        },
      });
      if (!user) {
        throw new AppError('User not found', 404, 'NOT_FOUND');
      }

      // Activity context — how many payouts this user has on the system, and
      // the most recent one (any status). Helps the admin sanity-check: a
      // user with 0 payouts and no latest is a brand-new host.
      const [totalPayouts, latest] = await Promise.all([
        prisma.payout.count({ where: { hostUserId: userId } }),
        prisma.payout.findFirst({
          where: { hostUserId: userId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      // Strip bank details to just the correspondence email (the only piece
      // an admin needs to reach the host about the wire). Keeps routing /
      // account numbers off the wire.
      let bankEmail: string | null = null;
      const bd = user.payoutBankDetails as any;
      if (bd && typeof bd === 'object' && typeof bd.email === 'string' && bd.email.trim()) {
        bankEmail = bd.email.trim();
      }

      // Validate the persisted method against the 3 hard rails. Anything else
      // is treated as unset so the UI shows the "Not set" state instead of a
      // garbage label.
      const rawMethod = user.preferredPayoutMethod;
      const method =
        rawMethod === 'mercury_card' || rawMethod === 'wire' || rawMethod === 'usdc_base'
          ? rawMethod
          : null;

      res.json({
        userId: user.id,
        name: user.name,
        email: user.email,
        preferredPayoutMethod: method,
        payoutWalletAddress: user.payoutWalletAddress,
        payoutBankDetails: bankEmail !== null ? { email: bankEmail } : null,
        totalPayouts,
        latestPayoutAt: latest?.createdAt ? latest.createdAt.toISOString() : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

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
  'flyer', 'print', 'party-guide', 'payments',
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

// GET /api/admin/social-post — Read current recap template + adjectives
router.get('/social-post', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }
    const { template, adjectives } = await getSocialPostConfig();
    res.json({ template, adjectives });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/social-post — Update the SocialPostModal recap copy (grissini-58481)
router.patch('/social-post', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { template, adjectives } = req.body;

    if (!template || typeof template !== 'string' || template.trim().length === 0) {
      throw new AppError('template is required', 400, 'VALIDATION_ERROR');
    }
    if (template.length > 1000) {
      throw new AppError('template must be 1000 characters or fewer', 400, 'VALIDATION_ERROR');
    }
    if (!Array.isArray(adjectives)) {
      throw new AppError('adjectives must be an array', 400, 'VALIDATION_ERROR');
    }

    const cleanedAdjectives = adjectives
      .map((a) => (typeof a === 'string' ? a.trim() : ''))
      .filter((a) => a.length > 0);

    if (cleanedAdjectives.length < 1 || cleanedAdjectives.length > 50) {
      throw new AppError('adjectives must have between 1 and 50 non-blank entries', 400, 'VALIDATION_ERROR');
    }
    if (cleanedAdjectives.some((a) => a.length > 50)) {
      throw new AppError('each adjective must be 50 characters or fewer', 400, 'VALIDATION_ERROR');
    }

    const value = JSON.stringify({ template, adjectives: cleanedAdjectives });

    await prisma.appConfig.upsert({
      where: { key: 'social_post_config' },
      update: { value, updatedAt: new Date() },
      create: { key: 'social_post_config', value },
    });

    invalidate('social_post_config');

    res.json({ success: true, config: { template, adjectives: cleanedAdjectives } });
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
                // pancetta-58472: store Privy-returned wallet lowercase to match the
                // canonical form used by every other write site.
                ethereumAddress: walletResult.walletAddress.toLowerCase(),
                privyUserId: walletResult.privyUserId,
                walletSource: 'privy-embedded',
              },
            });
            provisioned++;
            console.log(`[provision-wallets] Provisioned wallet for guest ${guest.id}: ${walletResult.walletAddress.toLowerCase()}`);
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

// mushroom-36006: regional opt-in A/B registry. Kept in sync with
// frontend/src/lib/optinAbRegions.ts. Each entry pairs an event tag with the
// per-region `swc_*_opt_in` boolean column on `guests`.
const OPTIN_AB_REGIONS: Array<{ tag: string; label: string; optInColumn: string }> = [
  { tag: 'swc',        label: 'US',        optInColumn: 'swc_opt_in'    },
  { tag: 'swccanada',  label: 'Canada',    optInColumn: 'swc_ca_opt_in' },
  { tag: 'swcau',      label: 'Australia', optInColumn: 'swc_au_opt_in' },
  { tag: 'swceu',      label: 'EU',        optInColumn: 'swc_eu_opt_in' },
  { tag: 'swcuk',      label: 'UK',        optInColumn: 'swc_uk_opt_in' },
  { tag: 'swcbr',      label: 'Brazil',    optInColumn: 'swc_br_opt_in' },
];

// GET /api/admin/experiments/optin-ab — mushroom-36006 per-region combined opt-in A/B results (admin only)
router.get('/experiments/optin-ab', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const valuesList = OPTIN_AB_REGIONS
      .map((r) => `('${r.tag.replace(/'/g, "''")}')`)
      .join(', ');
    const swcOptinCases = OPTIN_AB_REGIONS
      .map((r) => `(region.tag = '${r.tag.replace(/'/g, "''")}' AND g.${r.optInColumn})`)
      .join(' OR ');

    const sql = `
      SELECT
        region.tag                                                            AS region_tag,
        g.optin_ab_variant                                                    AS arm,
        COUNT(*)::int                                                         AS n,
        COUNT(*) FILTER (WHERE g.mailing_list_opt_in)::int                    AS pizzadao_optins,
        COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE g.mailing_list_opt_in)
                             / NULLIF(COUNT(*), 0), 2), 0)                    AS pizzadao_optin_pct,
        COUNT(*) FILTER (WHERE ${swcOptinCases})::int                         AS swc_optins,
        COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE ${swcOptinCases})
                             / NULLIF(COUNT(*), 0), 2), 0)                    AS swc_optin_pct
      FROM (VALUES ${valuesList}) AS region(tag)
      JOIN parties p ON region.tag = ANY(p.event_tags)
      JOIN guests  g ON g.party_id = p.id
      WHERE g.optin_ab_variant IN ('control', 'variant')
        AND g.submitted_via = 'link'
        AND (g.status IS NULL OR g.status != 'INVITED')
      GROUP BY region.tag, g.optin_ab_variant
      ORDER BY region.tag, g.optin_ab_variant
    `;

    const rows = await prisma.$queryRawUnsafe<Array<{
      region_tag: string;
      arm: string;
      n: number;
      pizzadao_optins: number;
      pizzadao_optin_pct: number | string;
      swc_optins: number;
      swc_optin_pct: number | string;
    }>>(sql);

    const byKey = new Map<string, typeof rows[number]>();
    for (const r of rows) byKey.set(`${r.region_tag}|${r.arm}`, r);

    const regions = OPTIN_AB_REGIONS.map((region) => ({
      tag: region.tag,
      label: region.label,
      arms: (['control', 'variant'] as const).map((arm) => {
        const r = byKey.get(`${region.tag}|${arm}`);
        return {
          arm,
          n: r ? Number(r.n) : 0,
          pizzadaoOptins: r ? Number(r.pizzadao_optins) : 0,
          pizzadaoOptinPct: r ? Number(r.pizzadao_optin_pct) : 0,
          swcOptins: r ? Number(r.swc_optins) : 0,
          swcOptinPct: r ? Number(r.swc_optin_pct) : 0,
        };
      }),
    }));

    res.set('Cache-Control', 'no-store');
    res.json({ regions });
  } catch (error) {
    next(error);
  }
});

router.get('/experiments/flags', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const flags = await prisma.experimentFlag.findMany({ orderBy: { key: 'asc' } });
    res.set('Cache-Control', 'no-store');
    res.json({ flags });
  } catch (error) {
    next(error);
  }
});

router.patch('/experiments/flags/:key', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const { key } = req.params;
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      throw new AppError('enabled (boolean) is required', 400, 'VALIDATION_ERROR');
    }
    const existing = await prisma.experimentFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new AppError('Flag not found', 404, 'NOT_FOUND');
    }
    const updated = await prisma.experimentFlag.update({
      where: { key },
      data: {
        enabled,
        updatedAt: new Date(),
        updatedBy: req.userEmail ?? null,
      },
    });
    res.json({ flag: updated });
  } catch (error) {
    next(error);
  }
});

// ── lasagna-49278: RSVP opt-in checkbox config admin ───────────────────────
// CRUD over the `rsvp_checkboxes` table. Frontend renderer (RsvpCheckboxList)
// reads rows directly from Supabase via anon SELECT; writes go through here.
// Schema isn't in Prisma — we use $queryRawUnsafe / $executeRawUnsafe.

// Hardcoded whitelist of allowed `opt_in_fields` values. Mirrors the 8
// destination columns on `guests`. Adding a 9th = explicit deploy (new
// Prisma field, new backend whitelist entry, new frontend setter mapping).
const ALLOWED_OPT_IN_FIELDS = new Set([
  'mailingListOptIn',
  'swcOptIn',
  'swcCaOptIn',
  'swcAuOptIn',
  'swcEuOptIn',
  'swcUkOptIn',
  'swcBrOptIn',
  'ethconfOptIn',
]);
const ALLOWED_ACCENT_COLORS = new Set(['red', 'purple']);
// The 8 seeded global IDs. DELETE without party_id on these is rejected —
// callers must soft-disable (active=false) instead.
const SEEDED_GLOBAL_IDS = new Set([
  'mailing_list', 'swc_us', 'swc_ca', 'swc_au', 'swc_eu', 'swc_uk', 'swc_br', 'ethconf',
]);

interface RsvpCheckboxRow {
  id: string;
  party_id: string | null;
  position: number;
  active: boolean;
  required_tags: string[];
  excluded_tags: string[];
  always_show: boolean;
  opt_in_fields: string[];
  combined_group: string | null;
  label_i18n_key: string | null;
  label_default: string | null;
  label_overrides: Record<string, string>;
  info_modal_i18n_ns: string | null;
  info_modal_privacy_url: string | null;
  info_modal_terms_url: string | null;
  info_modal_terms_key: string | null;
  modal_overrides: Record<string, unknown>;
  accent_color: string;
  updated_at: Date;
  updated_by: string | null;
}

function validateOptInFields(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError('opt_in_fields must be a non-empty array', 400, 'VALIDATION_ERROR');
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !ALLOWED_OPT_IN_FIELDS.has(v)) {
      throw new AppError(
        `opt_in_fields includes invalid value '${String(v)}'. Allowed: ${Array.from(ALLOWED_OPT_IN_FIELDS).join(', ')}`,
        400,
        'VALIDATION_ERROR',
      );
    }
    out.push(v);
  }
  return out;
}

function validateAccentColor(value: unknown): string {
  if (typeof value !== 'string' || !ALLOWED_ACCENT_COLORS.has(value)) {
    throw new AppError(
      `accent_color must be one of ${Array.from(ALLOWED_ACCENT_COLORS).join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return value;
}

function asStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an array of strings`, 400, 'VALIDATION_ERROR');
  }
  return value.map((v) => {
    if (typeof v !== 'string') {
      throw new AppError(`${fieldName} must be an array of strings`, 400, 'VALIDATION_ERROR');
    }
    return v;
  });
}

function asNullableString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string or null`, 400, 'VALIDATION_ERROR');
  }
  return value;
}

function asObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(`${fieldName} must be a JSON object`, 400, 'VALIDATION_ERROR');
  }
  return value as Record<string, unknown>;
}

// GET /api/admin/rsvp-checkboxes?party_id=<id>
router.get('/rsvp-checkboxes', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const partyId = typeof req.query.party_id === 'string' ? req.query.party_id : null;
    const rows = partyId
      ? await prisma.$queryRawUnsafe<RsvpCheckboxRow[]>(
          `SELECT id, party_id, position, active, required_tags, excluded_tags, always_show,
                  opt_in_fields, combined_group,
                  label_i18n_key, label_default, label_overrides,
                  info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
                  modal_overrides, accent_color, updated_at, updated_by
             FROM rsvp_checkboxes
            WHERE party_id = $1::uuid
            ORDER BY position`,
          partyId,
        )
      : await prisma.$queryRawUnsafe<RsvpCheckboxRow[]>(
          `SELECT id, party_id, position, active, required_tags, excluded_tags, always_show,
                  opt_in_fields, combined_group,
                  label_i18n_key, label_default, label_overrides,
                  info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
                  modal_overrides, accent_color, updated_at, updated_by
             FROM rsvp_checkboxes
            ORDER BY party_id NULLS FIRST, position`,
        );
    res.set('Cache-Control', 'no-store');
    res.json({ checkboxes: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/rsvp-checkboxes
router.post('/rsvp-checkboxes', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const body = req.body ?? {};
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw new AppError('id is required', 400, 'VALIDATION_ERROR');
    }
    const optInFields = validateOptInFields(body.opt_in_fields);
    const accentColor = validateAccentColor(body.accent_color ?? 'red');
    const partyId = asNullableString(body.party_id, 'party_id');
    const labelOverrides = asObject(body.label_overrides, 'label_overrides');
    const modalOverrides = asObject(body.modal_overrides, 'modal_overrides');

    const inserted = await prisma.$queryRawUnsafe<RsvpCheckboxRow[]>(
      `INSERT INTO rsvp_checkboxes (
         id, party_id, position, active,
         required_tags, excluded_tags, always_show,
         opt_in_fields, combined_group,
         label_i18n_key, label_default, label_overrides,
         info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
         modal_overrides, accent_color,
         updated_at, updated_by
       ) VALUES (
         $1, $2::uuid, $3, $4,
         $5::text[], $6::text[], $7,
         $8::text[], $9,
         $10, $11, $12::jsonb,
         $13, $14, $15, $16,
         $17::jsonb, $18,
         now(), $19
       )
       RETURNING id, party_id, position, active, required_tags, excluded_tags, always_show,
                 opt_in_fields, combined_group,
                 label_i18n_key, label_default, label_overrides,
                 info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
                 modal_overrides, accent_color, updated_at, updated_by`,
      body.id,
      partyId,
      typeof body.position === 'number' ? body.position : 0,
      body.active === false ? false : true,
      asStringArray(body.required_tags, 'required_tags'),
      asStringArray(body.excluded_tags, 'excluded_tags'),
      body.always_show === true,
      optInFields,
      asNullableString(body.combined_group, 'combined_group'),
      asNullableString(body.label_i18n_key, 'label_i18n_key'),
      asNullableString(body.label_default, 'label_default'),
      JSON.stringify(labelOverrides),
      asNullableString(body.info_modal_i18n_ns, 'info_modal_i18n_ns'),
      asNullableString(body.info_modal_privacy_url, 'info_modal_privacy_url'),
      asNullableString(body.info_modal_terms_url, 'info_modal_terms_url'),
      asNullableString(body.info_modal_terms_key, 'info_modal_terms_key'),
      JSON.stringify(modalOverrides),
      accentColor,
      req.userEmail ?? null,
    );
    res.json({ checkbox: inserted[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/rsvp-checkboxes/:id?party_id=<id?>
router.patch('/rsvp-checkboxes/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const { id } = req.params;
    const partyId = typeof req.query.party_id === 'string' && req.query.party_id.length > 0
      ? req.query.party_id
      : (typeof req.body?.party_id === 'string' ? req.body.party_id : null);

    // Validate any provided fields. Build a dynamic UPDATE set list.
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (sqlExpr: string, value: unknown) => {
      params.push(value);
      sets.push(`${sqlExpr} = $${params.length}`);
    };

    if (body.position !== undefined) add('position', typeof body.position === 'number' ? body.position : 0);
    if (body.active !== undefined) add('active', body.active === true);
    if (body.required_tags !== undefined) {
      params.push(asStringArray(body.required_tags, 'required_tags'));
      sets.push(`required_tags = $${params.length}::text[]`);
    }
    if (body.excluded_tags !== undefined) {
      params.push(asStringArray(body.excluded_tags, 'excluded_tags'));
      sets.push(`excluded_tags = $${params.length}::text[]`);
    }
    if (body.always_show !== undefined) add('always_show', body.always_show === true);
    if (body.opt_in_fields !== undefined) {
      params.push(validateOptInFields(body.opt_in_fields));
      sets.push(`opt_in_fields = $${params.length}::text[]`);
    }
    if (body.combined_group !== undefined) add('combined_group', asNullableString(body.combined_group, 'combined_group'));
    if (body.label_i18n_key !== undefined) add('label_i18n_key', asNullableString(body.label_i18n_key, 'label_i18n_key'));
    if (body.label_default !== undefined) add('label_default', asNullableString(body.label_default, 'label_default'));
    if (body.label_overrides !== undefined) {
      params.push(JSON.stringify(asObject(body.label_overrides, 'label_overrides')));
      sets.push(`label_overrides = $${params.length}::jsonb`);
    }
    if (body.info_modal_i18n_ns !== undefined) add('info_modal_i18n_ns', asNullableString(body.info_modal_i18n_ns, 'info_modal_i18n_ns'));
    if (body.info_modal_privacy_url !== undefined) add('info_modal_privacy_url', asNullableString(body.info_modal_privacy_url, 'info_modal_privacy_url'));
    if (body.info_modal_terms_url !== undefined) add('info_modal_terms_url', asNullableString(body.info_modal_terms_url, 'info_modal_terms_url'));
    if (body.info_modal_terms_key !== undefined) add('info_modal_terms_key', asNullableString(body.info_modal_terms_key, 'info_modal_terms_key'));
    if (body.modal_overrides !== undefined) {
      params.push(JSON.stringify(asObject(body.modal_overrides, 'modal_overrides')));
      sets.push(`modal_overrides = $${params.length}::jsonb`);
    }
    if (body.accent_color !== undefined) add('accent_color', validateAccentColor(body.accent_color));

    // Always stamp updated_at + updated_by.
    sets.push(`updated_at = now()`);
    params.push(req.userEmail ?? null);
    sets.push(`updated_by = $${params.length}`);

    if (sets.length <= 2) {
      // only the timestamp + actor — no actual field changes
      throw new AppError('No fields to update', 400, 'VALIDATION_ERROR');
    }

    // WHERE clause: id + (party_id IS NULL or = $X)
    params.push(id);
    const idPlaceholder = `$${params.length}`;
    let whereClause: string;
    if (partyId) {
      params.push(partyId);
      whereClause = `id = ${idPlaceholder} AND party_id = $${params.length}::uuid`;
    } else {
      whereClause = `id = ${idPlaceholder} AND party_id IS NULL`;
    }

    const updated = await prisma.$queryRawUnsafe<RsvpCheckboxRow[]>(
      `UPDATE rsvp_checkboxes SET ${sets.join(', ')}
         WHERE ${whereClause}
       RETURNING id, party_id, position, active, required_tags, excluded_tags, always_show,
                 opt_in_fields, combined_group,
                 label_i18n_key, label_default, label_overrides,
                 info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
                 modal_overrides, accent_color, updated_at, updated_by`,
      ...params,
    );
    if (updated.length === 0) {
      throw new AppError('Checkbox row not found', 404, 'NOT_FOUND');
    }
    res.json({ checkbox: updated[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/rsvp-checkboxes/:id?party_id=<id?>
router.delete('/rsvp-checkboxes/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const { id } = req.params;
    const partyId = typeof req.query.party_id === 'string' && req.query.party_id.length > 0
      ? req.query.party_id
      : null;

    // Reject DELETE of seeded global rows — force soft-disable instead.
    if (!partyId && SEEDED_GLOBAL_IDS.has(id)) {
      throw new AppError(
        'Use active=false to soft-disable seeded global rows (delete is reserved for custom checkboxes and per-event overrides)',
        400,
        'VALIDATION_ERROR',
      );
    }

    const sql = partyId
      ? `DELETE FROM rsvp_checkboxes WHERE id = $1 AND party_id = $2::uuid`
      : `DELETE FROM rsvp_checkboxes WHERE id = $1 AND party_id IS NULL`;
    const params: unknown[] = partyId ? [id, partyId] : [id];
    const deleted = await prisma.$executeRawUnsafe(sql, ...params);
    if (deleted === 0) {
      throw new AppError('Checkbox row not found', 404, 'NOT_FOUND');
    }
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
