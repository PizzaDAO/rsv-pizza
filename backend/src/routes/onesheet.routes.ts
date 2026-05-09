import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// Strict rate limit for interest form submissions
const interestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 submissions per hour per IP
  message: { error: 'Too many submissions, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

// POST /api/events/:slug/interest — submit partner interest (public, no auth)
router.post('/:slug/interest', interestLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const { name, email, company, message } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('Name is required', 400, 'MISSING_NAME');
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new AppError('Email is required', 400, 'MISSING_EMAIL');
    }
    if (!company || typeof company !== 'string' || !company.trim()) {
      throw new AppError('Company is required', 400, 'MISSING_COMPANY');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new AppError('Invalid email address', 400, 'INVALID_EMAIL');
    }

    // Find party by inviteCode → customUrl → slugAlias
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { id: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { id: true },
      });
    }
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: slug },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { id: true },
        });
      }
    }
    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // Check for duplicate by contactEmail on this event
    const existing = await prisma.sponsor.findFirst({
      where: {
        partyId: party.id,
        contactEmail: email.trim().toLowerCase(),
      },
    });
    if (existing) {
      throw new AppError('You have already expressed interest in partnering with this event', 409, 'DUPLICATE_INTEREST');
    }

    // Get next sortOrder
    const maxSort = await prisma.sponsor.aggregate({
      where: { partyId: party.id },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    // Create Sponsor record
    const sponsor = await prisma.sponsor.create({
      data: {
        partyId: party.id,
        name: company.trim(),
        contactName: name.trim(),
        contactEmail: email.trim().toLowerCase(),
        sponsorMessage: message?.trim() || null,
        status: 'asked',
        notes: 'Submitted via One Sheet interest form',
        intakeSubmittedAt: new Date(),
        sortOrder: nextSortOrder,
      },
    });

    res.status(201).json({ success: true, id: sponsor.id });
  } catch (error) {
    next(error);
  }
});

export default router;
