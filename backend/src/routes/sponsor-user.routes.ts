import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js';
import { requireSponsorAuth, SponsorRequest } from '../middleware/sponsorAuth.js';
import { AppError } from '../middleware/error.js';

// ============================================
// Admin management routes (mounted at /api/sponsor-users)
// ============================================

export const sponsorUserAdminRouter = Router();

// GET /api/sponsor-users/list - List all sponsor users (admin only)
sponsorUserAdminRouter.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const sponsorUsers = await prisma.sponsorUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ sponsorUsers });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor-users - Create a sponsor user (super admin only)
sponsorUserAdminRouter.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { email, tag, name, notes } = req.body;

    if (!email || !tag) {
      throw new AppError('Email and tag are required', 400, 'VALIDATION_ERROR');
    }

    // Check for existing sponsor with same email
    const existing = await prisma.sponsorUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      throw new AppError('A sponsor user with this email already exists', 409, 'CONFLICT');
    }

    const sponsorUser = await prisma.sponsorUser.create({
      data: {
        email: email.toLowerCase(),
        tag: tag.trim().toLowerCase(),
        name: name?.trim() || null,
        notes: notes?.trim() || null,
        createdBy: req.userEmail || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ sponsorUser });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor-users/:id - Update a sponsor user (super admin only)
sponsorUserAdminRouter.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { email, name, tag, notes, isActive } = req.body;

    const updateData: any = {};
    if (email !== undefined) updateData.email = email.toLowerCase();
    if (name !== undefined) updateData.name = name?.trim() || null;
    if (tag !== undefined) updateData.tag = tag.trim().toLowerCase();
    if (notes !== undefined) updateData.notes = notes?.trim() || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const sponsorUser = await prisma.sponsorUser.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ sponsorUser });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/sponsor-users/:id - Deactivate a sponsor user (super admin only)
sponsorUserAdminRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    await prisma.sponsorUser.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Sponsor user deactivated' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Sponsor Dashboard routes (mounted at /api/sponsor)
// ============================================

export const sponsorDashboardRouter = Router();

// GET /api/sponsor/me - Check if logged-in user is a sponsor
sponsorDashboardRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const sponsorUser = await prisma.sponsorUser.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
      },
    });

    if (sponsorUser) {
      return res.json({
        isSponsor: true,
        sponsor: {
          id: sponsorUser.id,
          email: sponsorUser.email,
          name: sponsorUser.name,
          tag: sponsorUser.tag,
        },
      });
    }

    return res.json({
      isSponsor: false,
      sponsor: null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/sponsor/events - Get all events matching sponsor's tag
sponsorDashboardRouter.get('/events', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    const tag = req.sponsorUser!.tag;
    const sponsorUserId = req.sponsorUser!.id;

    // Find events where eventTags contains the sponsor's tag
    const events = await prisma.party.findMany({
      where: {
        eventTags: { has: tag },
      },
      include: {
        user: { select: { name: true, email: true, profilePictureUrl: true, website: true, twitter: true, instagram: true } },
        guests: {
          select: { id: true, approved: true },
        },
        budgetItems: {
          select: { id: true, cost: true, status: true },
        },
        sponsorChecklistItems: {
          where: { sponsorUserId },
          select: {
            id: true,
            name: true,
            completed: true,
            completedAt: true,
            dueDate: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { guests: true } },
      },
      orderBy: { date: 'asc' },
    });

    const formattedEvents = events.map(event => {
      const guestCount = event._count.guests;
      const approvedCount = event.guests.filter(g => g.approved !== false).length;

      // Budget summary
      let budget = null;
      if (event.budgetEnabled && event.budgetItems.length > 0) {
        const totalBudget = event.budgetTotal ? Number(event.budgetTotal) : 0;
        const totalSpent = event.budgetItems.reduce((sum, item) => sum + Number(item.cost), 0);
        const totalPaid = event.budgetItems
          .filter(item => item.status === 'paid')
          .reduce((sum, item) => sum + Number(item.cost), 0);
        const totalPending = totalSpent - totalPaid;

        budget = {
          total: totalBudget,
          spent: totalSpent,
          paid: totalPaid,
          pending: totalPending,
          remaining: totalBudget > 0 ? totalBudget - totalSpent : null,
        };
      }

      // Co-hosts
      const coHosts = Array.isArray(event.coHosts) ? event.coHosts : [];

      return {
        id: event.id,
        name: event.name,
        slug: event.customUrl || event.inviteCode,
        date: event.date,
        timezone: event.timezone,
        address: event.address,
        venueName: event.venueName,
        eventImageUrl: event.eventImageUrl,
        hostName: event.user?.name || null,
        hostProfile: event.user ? {
          name: event.user.name,
          avatar_url: event.user.profilePictureUrl,
          website: event.user.website,
          twitter: event.user.twitter,
          instagram: event.user.instagram,
        } : null,
        coHosts,
        rsvpCount: guestCount,
        approvedCount,
        maxGuests: event.maxGuests,
        budget,
        checklist: event.sponsorChecklistItems.map(item => ({
          id: item.id,
          name: item.name,
          completed: item.completed,
          completedAt: item.completedAt,
          dueDate: item.dueDate,
          sortOrder: item.sortOrder,
        })),
      };
    });

    res.json({
      sponsor: {
        name: req.sponsorUser!.name,
        email: req.sponsorUser!.email,
        tag: req.sponsorUser!.tag,
      },
      events: formattedEvents,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor/checklist/:itemId/toggle - Toggle a checklist item
sponsorDashboardRouter.post('/checklist/:itemId/toggle', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    const { itemId } = req.params;
    const sponsorUserId = req.sponsorUser!.id;

    // Verify the checklist item belongs to this sponsor
    const item = await prisma.sponsorChecklistItem.findFirst({
      where: { id: itemId, sponsorUserId },
    });

    if (!item) {
      throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    }

    const updated = await prisma.sponsorChecklistItem.update({
      where: { id: itemId },
      data: {
        completed: !item.completed,
        completedAt: !item.completed ? new Date() : null,
      },
      select: {
        id: true,
        name: true,
        completed: true,
        completedAt: true,
        dueDate: true,
        sortOrder: true,
      },
    });

    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});
