import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { detectTrackingUrl } from '../utils/trackingUtils.js';

// Valid kit statuses and tiers
const VALID_STATUSES = ['pending', 'approved', 'shipped', 'delivered', 'declined'];
const VALID_TIERS = ['basic', 'large', 'deluxe'];
const VALID_REGIONS = ['usa', 'canada', 'central-america', 'south-america', 'western-europe', 'eastern-europe', 'west-africa', 'east-africa', 'south-africa', 'india', 'china', 'middle-east', 'asia', 'oceania'];

// Extend AuthRequest for shipping
interface ShippingRequest extends AuthRequest {
  shippingRole?: 'admin' | 'coordinator';
  shippingRegions?: string[];
}

// Auth middleware: checks admin table then shipping_coordinators
async function requireShippingAuth(req: ShippingRequest, res: Response, next: NextFunction) {
  try {
    const email = req.userEmail?.toLowerCase();
    if (!email) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    // Check if user is an admin first
    if (await isAdmin(email)) {
      req.shippingRole = 'admin';
      req.shippingRegions = ['__admin__'];
      return next();
    }

    // Check shipping_coordinators table
    const coordinator = await prisma.shippingCoordinator.findFirst({
      where: { email, isActive: true },
    });
    if (coordinator) {
      req.shippingRole = 'coordinator';
      req.shippingRegions = coordinator.regions;
      return next();
    }

    throw new AppError('Shipping access required', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}

// Helper: build region filter for kit queries
function buildRegionFilter(regions: string[]) {
  if (regions.includes('__admin__')) return {}; // admin sees all
  return { party: { region: { in: regions } } };
}

// Helper: check if user has access to a specific region
function isAuthorizedForRegion(regions: string[], region: string): boolean {
  if (regions.includes('__admin__')) return true;
  return regions.includes(region);
}

const router = Router();

// ============================================
// GET /api/shipping/me - Current user's shipping role + regions
// ============================================
router.get('/me', requireAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail?.toLowerCase();
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Check admin first
    if (await isAdmin(email)) {
      return res.json({
        role: 'admin',
        regions: ['__admin__'],
        name: 'Admin',
        email,
      });
    }

    // Check shipping coordinator
    const coordinator = await prisma.shippingCoordinator.findFirst({
      where: { email, isActive: true },
    });
    if (coordinator) {
      return res.json({
        role: 'coordinator',
        regions: coordinator.regions,
        name: coordinator.name,
        email: coordinator.email,
      });
    }

    // Not authorized
    return res.json({
      role: null,
      regions: [],
      name: null,
      email,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/shipping/stats - Aggregate stats
// ============================================
router.get('/stats', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    const kits = await prisma.partyKit.findMany({
      where: regionFilter,
      select: {
        status: true,
        country: true,
        requestedTier: true,
        allocatedTier: true,
      },
    });

    const stats = {
      total: kits.length,
      pending: kits.filter(k => k.status === 'pending').length,
      approved: kits.filter(k => k.status === 'approved').length,
      shipped: kits.filter(k => k.status === 'shipped').length,
      delivered: kits.filter(k => k.status === 'delivered').length,
      declined: kits.filter(k => k.status === 'declined').length,
      byCountry: {} as Record<string, number>,
      byTier: {} as Record<string, number>,
    };

    for (const kit of kits) {
      const country = kit.country || 'Unknown';
      stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;

      const tier = kit.allocatedTier || kit.requestedTier;
      stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
    }

    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/shipping/kits/export - CSV export (must be before :kitId)
// ============================================
router.get('/kits/export', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { status, tier, country, region, search } = req.query;
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    const where: any = { ...regionFilter };

    if (status && typeof status === 'string') {
      where.status = status;
    }
    if (tier && typeof tier === 'string') {
      where.OR = [{ requestedTier: tier }, { allocatedTier: tier }];
    }
    if (country && typeof country === 'string') {
      where.country = country;
    }
    if (region && typeof region === 'string') {
      if (!isAuthorizedForRegion(req.shippingRegions!, region)) {
        throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
      }
      where.party = { ...where.party, region };
    }

    const kits = await prisma.partyKit.findMany({
      where,
      include: {
        party: {
          select: {
            name: true,
            region: true,
            date: true,
            address: true,
            venueName: true,
            underbossApproved: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    // Apply search filter in memory (on party name, host name, recipient name, city)
    let filtered = kits;
    if (search && typeof search === 'string') {
      const term = search.toLowerCase();
      filtered = kits.filter(k =>
        k.recipientName.toLowerCase().includes(term) ||
        k.city.toLowerCase().includes(term) ||
        k.party.name.toLowerCase().includes(term) ||
        (k.party.user?.name || '').toLowerCase().includes(term)
      );
    }

    // Build CSV
    const headers = ['Kit ID', 'Event Name', 'Region', 'Host Name', 'Host Email', 'Event Venue', 'Event Address', 'Event Approved', 'Recipient', 'Address 1', 'Address 2', 'City', 'State', 'Postal Code', 'Country', 'Phone', 'Requested Tier', 'Allocated Tier', 'Status', 'Notes', 'Tracking Number', 'Tracking URL'];
    const csvRows = [headers.join(',')];

    for (const kit of filtered) {
      const row = [
        escapeCSV(kit.id),
        escapeCSV(kit.party.name),
        escapeCSV(kit.party.region || ''),
        escapeCSV(kit.party.user?.name || ''),
        escapeCSV(kit.party.user?.email || ''),
        escapeCSV(kit.party.venueName || ''),
        escapeCSV(kit.party.address || ''),
        escapeCSV(kit.party.underbossApproved ? 'Yes' : 'No'),
        escapeCSV(kit.recipientName),
        escapeCSV(kit.addressLine1),
        escapeCSV(kit.addressLine2 || ''),
        escapeCSV(kit.city),
        escapeCSV(kit.state || ''),
        escapeCSV(kit.postalCode),
        escapeCSV(kit.country),
        escapeCSV(kit.phone || ''),
        escapeCSV(kit.requestedTier),
        escapeCSV(kit.allocatedTier || ''),
        escapeCSV(kit.status),
        escapeCSV(kit.notes || ''),
        escapeCSV(kit.trackingNumber || ''),
        escapeCSV(kit.trackingUrl || ''),
      ];
      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=shipping-kits-export.csv');
    res.send(csvRows.join('\n'));
  } catch (error) {
    next(error);
  }
});

// ============================================
// PATCH /api/shipping/kits/bulk-update - Bulk update (must be before :kitId)
// ============================================
router.patch('/kits/bulk-update', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { kitIds, updates } = req.body;

    if (!Array.isArray(kitIds) || kitIds.length === 0) {
      throw new AppError('kitIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (!updates || typeof updates !== 'object') {
      throw new AppError('updates must be an object', 400, 'VALIDATION_ERROR');
    }

    // Validate status if provided
    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      throw new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate tier if provided
    if (updates.allocatedTier && !VALID_TIERS.includes(updates.allocatedTier)) {
      throw new AppError(`Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Build update data
    const updateData: any = {};
    if (updates.status) {
      updateData.status = updates.status;
      if (updates.status === 'approved') updateData.approvedAt = new Date();
      if (updates.status === 'shipped') updateData.shippedAt = new Date();
      if (updates.status === 'delivered') updateData.deliveredAt = new Date();
    }
    if (updates.allocatedTier) updateData.allocatedTier = updates.allocatedTier;
    if (updates.adminNotes !== undefined) updateData.adminNotes = updates.adminNotes;
    if (updates.trackingNumber !== undefined) updateData.trackingNumber = updates.trackingNumber;
    if (updates.trackingUrl !== undefined) updateData.trackingUrl = updates.trackingUrl;

    // Region-gate: only update kits the user has access to
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    const result = await prisma.partyKit.updateMany({
      where: {
        id: { in: kitIds },
        ...regionFilter,
      },
      data: updateData,
    });

    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/shipping/kits/import-tracking - Bulk import tracking numbers from CSV
// ============================================
router.post('/kits/import-tracking', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('items must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (items.length > 500) {
      throw new AppError('Maximum 500 items per import', 400, 'VALIDATION_ERROR');
    }

    const regionFilter = buildRegionFilter(req.shippingRegions!);
    let updated = 0;
    let skipped = 0;
    const notFound: string[] = [];

    for (const item of items) {
      const { kitId, trackingNumber, trackingUrl } = item;

      if (!kitId) {
        skipped++;
        continue;
      }

      // Skip rows with no tracking data
      if (!trackingNumber && !trackingUrl) {
        skipped++;
        continue;
      }

      // Verify kit exists and user has access
      const kit = await prisma.partyKit.findFirst({
        where: { id: kitId, ...regionFilter },
      });

      if (!kit) {
        notFound.push(kitId);
        continue;
      }

      const updateData: any = {};
      if (trackingNumber) updateData.trackingNumber = trackingNumber;

      if (trackingUrl) {
        updateData.trackingUrl = trackingUrl;
      } else if (trackingNumber) {
        // Auto-detect URL from tracking number
        const detected = detectTrackingUrl(trackingNumber);
        if (detected) updateData.trackingUrl = detected;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.partyKit.update({
          where: { id: kitId },
          data: updateData,
        });
        updated++;
      } else {
        skipped++;
      }
    }

    res.json({ updated, skipped, notFound });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/shipping/kits - List kits with filters
// ============================================
router.get('/kits', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { status, tier, country, region, search, sort } = req.query;
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    const where: any = { ...regionFilter };

    if (status && typeof status === 'string') {
      where.status = status;
    }
    if (tier && typeof tier === 'string') {
      where.OR = [{ requestedTier: tier }, { allocatedTier: tier }];
    }
    if (country && typeof country === 'string') {
      where.country = country;
    }
    if (region && typeof region === 'string') {
      if (!isAuthorizedForRegion(req.shippingRegions!, region)) {
        throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
      }
      where.party = { ...where.party, region };
    }

    // Determine sort order
    let orderBy: any = { requestedAt: 'desc' };
    if (sort && typeof sort === 'string') {
      switch (sort) {
        case 'requestedAt': orderBy = { requestedAt: 'asc' }; break;
        case 'requestedAt_desc': orderBy = { requestedAt: 'desc' }; break;
        case 'status': orderBy = { status: 'asc' }; break;
        case 'status_desc': orderBy = { status: 'desc' }; break;
        case 'country': orderBy = { country: 'asc' }; break;
        case 'country_desc': orderBy = { country: 'desc' }; break;
        case 'eventDate': orderBy = { party: { date: 'asc' } }; break;
        case 'eventDate_desc': orderBy = { party: { date: 'desc' } }; break;
      }
    }

    const kits = await prisma.partyKit.findMany({
      where,
      include: {
        party: {
          select: {
            id: true,
            name: true,
            region: true,
            date: true,
            address: true,
            venueName: true,
            underbossApproved: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy,
    });

    // Apply search filter in memory
    let filtered = kits;
    if (search && typeof search === 'string') {
      const term = search.toLowerCase();
      filtered = kits.filter(k =>
        k.recipientName.toLowerCase().includes(term) ||
        k.city.toLowerCase().includes(term) ||
        k.party.name.toLowerCase().includes(term) ||
        (k.party.user?.name || '').toLowerCase().includes(term) ||
        (k.party.user?.email || '').toLowerCase().includes(term)
      );
    }

    // Format response
    const formattedKits = filtered.map(kit => ({
      id: kit.id,
      partyId: kit.partyId,
      partyName: kit.party.name,
      eventDate: kit.party.date?.toISOString() || null,
      region: kit.party.region || null,
      hostName: kit.party.user?.name || null,
      hostEmail: kit.party.user?.email || null,
      eventAddress: kit.party.address || null,
      eventVenue: kit.party.venueName || null,
      underbossApproved: kit.party.underbossApproved || false,
      requestedTier: kit.requestedTier,
      allocatedTier: kit.allocatedTier,
      recipientName: kit.recipientName,
      addressLine1: kit.addressLine1,
      addressLine2: kit.addressLine2,
      city: kit.city,
      state: kit.state,
      postalCode: kit.postalCode,
      country: kit.country,
      phone: kit.phone,
      status: kit.status,
      trackingNumber: kit.trackingNumber,
      trackingUrl: kit.trackingUrl,
      notes: kit.notes,
      adminNotes: kit.adminNotes,
      requestedAt: kit.requestedAt.toISOString(),
      approvedAt: kit.approvedAt?.toISOString() || null,
      shippedAt: kit.shippedAt?.toISOString() || null,
      deliveredAt: kit.deliveredAt?.toISOString() || null,
    }));

    res.json({ kits: formattedKits });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/shipping/kits/:kitId - Single kit detail
// ============================================
router.get('/kits/:kitId', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { kitId } = req.params;
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    const kit = await prisma.partyKit.findFirst({
      where: { id: kitId, ...regionFilter },
      include: {
        party: {
          select: {
            id: true,
            name: true,
            region: true,
            date: true,
            address: true,
            venueName: true,
            underbossApproved: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!kit) {
      throw new AppError('Kit not found', 404, 'NOT_FOUND');
    }

    res.json({
      kit: {
        id: kit.id,
        partyId: kit.partyId,
        partyName: kit.party.name,
        eventDate: kit.party.date?.toISOString() || null,
        region: kit.party.region || null,
        hostName: kit.party.user?.name || null,
        hostEmail: kit.party.user?.email || null,
        eventAddress: kit.party.address || null,
        eventVenue: kit.party.venueName || null,
        underbossApproved: kit.party.underbossApproved || false,
        requestedTier: kit.requestedTier,
        allocatedTier: kit.allocatedTier,
        recipientName: kit.recipientName,
        addressLine1: kit.addressLine1,
        addressLine2: kit.addressLine2,
        city: kit.city,
        state: kit.state,
        postalCode: kit.postalCode,
        country: kit.country,
        phone: kit.phone,
        status: kit.status,
        trackingNumber: kit.trackingNumber,
        trackingUrl: kit.trackingUrl,
        notes: kit.notes,
        adminNotes: kit.adminNotes,
        requestedAt: kit.requestedAt.toISOString(),
        approvedAt: kit.approvedAt?.toISOString() || null,
        shippedAt: kit.shippedAt?.toISOString() || null,
        deliveredAt: kit.deliveredAt?.toISOString() || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PATCH /api/shipping/kits/:kitId - Update a kit
// ============================================
router.patch('/kits/:kitId', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    const { kitId } = req.params;
    const { status, allocatedTier, trackingNumber, trackingUrl, adminNotes } = req.body;
    const regionFilter = buildRegionFilter(req.shippingRegions!);

    // Verify the kit exists and user has region access
    const existingKit = await prisma.partyKit.findFirst({
      where: { id: kitId, ...regionFilter },
    });

    if (!existingKit) {
      throw new AppError('Kit not found or not authorized', 404, 'NOT_FOUND');
    }

    const updateData: any = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        throw new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
      updateData.status = status;
      if (status === 'approved' && existingKit.status !== 'approved') {
        updateData.approvedAt = new Date();
      }
      if (status === 'shipped' && existingKit.status !== 'shipped') {
        updateData.shippedAt = new Date();
      }
      if (status === 'delivered' && existingKit.status !== 'delivered') {
        updateData.deliveredAt = new Date();
      }
    }

    if (allocatedTier !== undefined) {
      if (allocatedTier && !VALID_TIERS.includes(allocatedTier)) {
        throw new AppError(`Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
      updateData.allocatedTier = allocatedTier;
    }

    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (trackingUrl !== undefined) updateData.trackingUrl = trackingUrl;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    // Auto-detect tracking URL if tracking number provided but URL is missing/empty
    if (updateData.trackingNumber && !updateData.trackingUrl && trackingUrl === undefined) {
      const detected = detectTrackingUrl(updateData.trackingNumber);
      if (detected) updateData.trackingUrl = detected;
    }

    const updatedKit = await prisma.partyKit.update({
      where: { id: kitId },
      data: updateData,
      include: {
        party: {
          select: {
            name: true,
            region: true,
            date: true,
            address: true,
            venueName: true,
            underbossApproved: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    res.json({
      kit: {
        id: updatedKit.id,
        partyId: updatedKit.partyId,
        partyName: updatedKit.party.name,
        eventDate: updatedKit.party.date?.toISOString() || null,
        region: updatedKit.party.region || null,
        hostName: updatedKit.party.user?.name || null,
        hostEmail: updatedKit.party.user?.email || null,
        eventAddress: updatedKit.party.address || null,
        eventVenue: updatedKit.party.venueName || null,
        underbossApproved: updatedKit.party.underbossApproved || false,
        requestedTier: updatedKit.requestedTier,
        allocatedTier: updatedKit.allocatedTier,
        recipientName: updatedKit.recipientName,
        addressLine1: updatedKit.addressLine1,
        addressLine2: updatedKit.addressLine2,
        city: updatedKit.city,
        state: updatedKit.state,
        postalCode: updatedKit.postalCode,
        country: updatedKit.country,
        phone: updatedKit.phone,
        status: updatedKit.status,
        trackingNumber: updatedKit.trackingNumber,
        trackingUrl: updatedKit.trackingUrl,
        notes: updatedKit.notes,
        adminNotes: updatedKit.adminNotes,
        requestedAt: updatedKit.requestedAt.toISOString(),
        approvedAt: updatedKit.approvedAt?.toISOString() || null,
        shippedAt: updatedKit.shippedAt?.toISOString() || null,
        deliveredAt: updatedKit.deliveredAt?.toISOString() || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Admin routes: Coordinator management (admin only)
// ============================================

// GET /api/shipping/admin/coordinators
router.get('/admin/coordinators', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    if (req.shippingRole !== 'admin') {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const coordinators = await prisma.shippingCoordinator.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({ coordinators });
  } catch (error) {
    next(error);
  }
});

// POST /api/shipping/admin/coordinators
router.post('/admin/coordinators', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    if (req.shippingRole !== 'admin') {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { name, email, regions, notes } = req.body;

    if (!name || !email) {
      throw new AppError('Name and email are required', 400, 'VALIDATION_ERROR');
    }

    if (!Array.isArray(regions) || regions.length === 0) {
      throw new AppError('At least one region is required', 400, 'VALIDATION_ERROR');
    }

    // Validate regions
    for (const r of regions) {
      if (!VALID_REGIONS.includes(r)) {
        throw new AppError(`Invalid region: ${r}`, 400, 'VALIDATION_ERROR');
      }
    }

    const coordinator = await prisma.shippingCoordinator.create({
      data: {
        name,
        email: email.toLowerCase(),
        regions,
        notes: notes || null,
      },
    });

    res.status(201).json({ coordinator });
  } catch (error: any) {
    if (error.code === 'P2002') {
      next(new AppError('A coordinator with this email already exists', 409, 'DUPLICATE'));
    } else {
      next(error);
    }
  }
});

// PATCH /api/shipping/admin/coordinators/:id
router.patch('/admin/coordinators/:id', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    if (req.shippingRole !== 'admin') {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { name, email, regions, notes, isActive } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email.toLowerCase();
    if (notes !== undefined) updateData.notes = notes || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (Array.isArray(regions)) {
      for (const r of regions) {
        if (!VALID_REGIONS.includes(r)) {
          throw new AppError(`Invalid region: ${r}`, 400, 'VALIDATION_ERROR');
        }
      }
      updateData.regions = regions;
    }

    const coordinator = await prisma.shippingCoordinator.update({
      where: { id },
      data: updateData,
    });

    res.json({ coordinator });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/shipping/admin/coordinators/:id (soft delete - deactivate)
router.delete('/admin/coordinators/:id', requireAuth, requireShippingAuth, async (req: ShippingRequest, res: Response, next: NextFunction) => {
  try {
    if (req.shippingRole !== 'admin') {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    await prisma.shippingCoordinator.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Coordinator deactivated' });
  } catch (error) {
    next(error);
  }
});

// Helper: escape CSV field
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default router;
