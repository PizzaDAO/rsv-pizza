import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Check if user is the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  if (party) return true;

  // Check if user is a co-host with edit access
  const partyForCohost = await prisma.party.findUnique({
    where: { id: partyId },
    select: { coHosts: true },
  });

  if (partyForCohost?.coHosts) {
    const coHosts = partyForCohost.coHosts as any[];
    const isCoHost = coHosts.some(
      (ch: any) => ch.email?.toLowerCase() === userEmail?.toLowerCase() && ch.canEdit
    );
    if (isCoHost) return true;
  }

  return false;
}

// Sponsor-facing fields that the intake form is allowed to read/write
const SPONSOR_FACING_FIELDS = [
  'name',
  'website',
  'brandTwitter',
  'brandInstagram',
  'brandDescription',
  'contactName',
  'contactEmail',
  'contactPhone',
  'contactTwitter',
  'telegram',
  'sponsorshipType',
  'productService',
  'logoUrl',
  'sponsorMessage',
] as const;

const router = Router();

// POST /api/sponsor-intake/generate-token/:partyId/:sponsorId — generate intake token (auth required)
router.post('/generate-token/:partyId/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or co-host
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify sponsor exists and belongs to this party
    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // If token already exists, return it
    if (sponsor.intakeToken) {
      return res.json({
        token: sponsor.intakeToken,
        url: `https://rsv.pizza/sponsor-intake/${sponsor.intakeToken}`,
      });
    }

    // Generate new token
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.sponsor.update({
      where: { id: sponsorId },
      data: { intakeToken: token },
    });

    res.json({
      token,
      url: `https://rsv.pizza/sponsor-intake/${token}`,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/sponsor-intake/revoke-token/:partyId/:sponsorId — revoke intake token (auth required)
router.delete('/revoke-token/:partyId/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or co-host
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify sponsor exists and belongs to this party
    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    await prisma.sponsor.update({
      where: { id: sponsorId },
      data: {
        intakeToken: null,
        intakeSubmittedAt: null,
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/sponsor-intake/:token — public, fetch sponsor data for intake form
router.get('/:token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      throw new AppError('Invalid token', 400, 'INVALID_TOKEN');
    }

    const sponsor = await prisma.sponsor.findUnique({
      where: { intakeToken: token },
      include: {
        party: {
          select: { name: true },
        },
      },
    });

    if (!sponsor) {
      throw new AppError('Intake link not found or has been revoked', 404, 'NOT_FOUND');
    }

    // Return only sponsor-facing fields + event name
    res.json({
      sponsor: {
        name: sponsor.name,
        website: sponsor.website,
        brandTwitter: sponsor.brandTwitter,
        brandInstagram: sponsor.brandInstagram,
        brandDescription: sponsor.brandDescription,
        contactName: sponsor.contactName,
        contactEmail: sponsor.contactEmail,
        contactPhone: sponsor.contactPhone,
        contactTwitter: sponsor.contactTwitter,
        telegram: sponsor.telegram,
        sponsorshipType: sponsor.sponsorshipType,
        productService: sponsor.productService,
        logoUrl: sponsor.logoUrl,
        sponsorMessage: sponsor.sponsorMessage,
        intakeSubmittedAt: sponsor.intakeSubmittedAt,
      },
      eventName: sponsor.party.name,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor-intake/:token — public, submit intake form
router.post('/:token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      throw new AppError('Invalid token', 400, 'INVALID_TOKEN');
    }

    const sponsor = await prisma.sponsor.findUnique({
      where: { intakeToken: token },
    });

    if (!sponsor) {
      throw new AppError('Intake link not found or has been revoked', 404, 'NOT_FOUND');
    }

    // Build update data from ONLY sponsor-facing fields
    const updateData: Record<string, any> = {};

    const body = req.body;

    if (body.name !== undefined && typeof body.name === 'string' && body.name.trim().length > 0) {
      updateData.name = body.name.trim();
    }
    if (body.website !== undefined) {
      updateData.website = body.website?.trim() || null;
    }
    if (body.brandTwitter !== undefined) {
      updateData.brandTwitter = body.brandTwitter?.trim() || null;
    }
    if (body.brandInstagram !== undefined) {
      updateData.brandInstagram = body.brandInstagram?.trim() || null;
    }
    if (body.brandDescription !== undefined) {
      updateData.brandDescription = body.brandDescription?.trim() || null;
    }
    if (body.contactName !== undefined) {
      updateData.contactName = body.contactName?.trim() || null;
    }
    if (body.contactEmail !== undefined) {
      updateData.contactEmail = body.contactEmail?.trim()?.toLowerCase() || null;
    }
    if (body.contactPhone !== undefined) {
      updateData.contactPhone = body.contactPhone?.trim() || null;
    }
    if (body.contactTwitter !== undefined) {
      updateData.contactTwitter = body.contactTwitter?.trim() || null;
    }
    if (body.telegram !== undefined) {
      updateData.telegram = body.telegram?.trim() || null;
    }
    if (body.sponsorshipType !== undefined) {
      const validTypes = ['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other'];
      if (body.sponsorshipType && !validTypes.includes(body.sponsorshipType)) {
        throw new AppError(`Invalid sponsorship type. Must be one of: ${validTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
      updateData.sponsorshipType = body.sponsorshipType || null;
    }
    if (body.productService !== undefined) {
      updateData.productService = body.productService?.trim() || null;
    }
    if (body.logoUrl !== undefined) {
      updateData.logoUrl = body.logoUrl?.trim() || null;
    }
    if (body.sponsorMessage !== undefined) {
      updateData.sponsorMessage = body.sponsorMessage?.trim() || null;
    }

    // Always set intakeSubmittedAt on submission
    updateData.intakeSubmittedAt = new Date();

    await prisma.sponsor.update({
      where: { id: sponsor.id },
      data: updateData,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
