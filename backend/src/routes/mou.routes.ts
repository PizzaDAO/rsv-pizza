import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';

// ============================================
// Host routes (mounted at /api/parties)
// ============================================
const hostRouter = Router();

// GET /api/parties/:partyId/mous - List all MOUs for a party
hostRouter.get('/:partyId/mous', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const mous = await prisma.mou.findMany({
      where: { partyId },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ mous });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/mous/:mouId - Get single MOU
hostRouter.get('/:partyId/mous/:mouId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, mouId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const mou = await prisma.mou.findFirst({
      where: { id: mouId, partyId },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
        party: {
          select: { name: true },
        },
      },
    });

    if (!mou) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    res.json({ mou });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/mous - Create MOU for a sponsor
hostRouter.post('/:partyId/mous', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      sponsorId,
      counterpartyCompany,
      counterpartyContact,
      counterpartyEmail,
      ccEmails,
      title,
      bodyMarkdown,
      effectiveDate,
      termText,
      attachments,
    } = req.body;

    if (!sponsorId) {
      throw new AppError('Sponsor ID is required', 400, 'VALIDATION_ERROR');
    }

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Verify sponsor exists and belongs to this party
    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // Auto-generate MOU number (count existing + 1, zero-padded to 3 digits)
    const existingCount = await prisma.mou.count({
      where: { partyId },
    });
    const mouNumber = String(existingCount + 1).padStart(3, '0');

    // Generate view token
    const viewToken = crypto.randomBytes(32).toString('hex');

    // Use sponsor data as defaults for counterparty fields
    const finalCounterpartyEmail = counterpartyEmail || sponsor.contactEmail;
    if (!finalCounterpartyEmail) {
      throw new AppError('Counterparty email is required (sponsor has no contact email)', 400, 'VALIDATION_ERROR');
    }

    const mou = await prisma.mou.create({
      data: {
        partyId,
        sponsorId,
        mouNumber,
        viewToken,
        counterpartyCompany: counterpartyCompany || sponsor.name || null,
        counterpartyContact: counterpartyContact || sponsor.contactName || null,
        counterpartyEmail: finalCounterpartyEmail,
        ccEmails: ccEmails || [],
        title: title || 'Memorandum of Understanding',
        bodyMarkdown: bodyMarkdown || '',
        effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
        termText: termText || null,
        attachments: attachments || [],
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    res.status(201).json({ mou });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/mous/:mouId - Update MOU (draft/issued only)
hostRouter.patch('/:partyId/mous/:mouId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, mouId } = req.params;
    const {
      counterpartyCompany,
      counterpartyContact,
      counterpartyEmail,
      ccEmails,
      title,
      bodyMarkdown,
      effectiveDate,
      termText,
      attachments,
    } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const existing = await prisma.mou.findFirst({
      where: { id: mouId, partyId },
    });

    if (!existing) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    // Only draft or issued MOUs can be edited (not signed/cancelled)
    if (!['draft', 'issued', 'viewed'].includes(existing.status)) {
      throw new AppError('Only draft or issued MOUs can be edited', 400, 'VALIDATION_ERROR');
    }

    const mou = await prisma.mou.update({
      where: { id: mouId },
      data: {
        ...(counterpartyCompany !== undefined && { counterpartyCompany: counterpartyCompany || null }),
        ...(counterpartyContact !== undefined && { counterpartyContact: counterpartyContact || null }),
        ...(counterpartyEmail !== undefined && { counterpartyEmail }),
        ...(ccEmails !== undefined && { ccEmails }),
        ...(title !== undefined && { title }),
        ...(bodyMarkdown !== undefined && { bodyMarkdown }),
        ...(effectiveDate !== undefined && { effectiveDate: effectiveDate ? new Date(effectiveDate) : null }),
        ...(termText !== undefined && { termText: termText || null }),
        ...(attachments !== undefined && { attachments }),
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    res.json({ mou });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/mous/:mouId - Delete draft MOU
hostRouter.delete('/:partyId/mous/:mouId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, mouId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const existing = await prisma.mou.findFirst({
      where: { id: mouId, partyId },
    });

    if (!existing) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'draft') {
      throw new AppError('Only draft MOUs can be deleted', 400, 'VALIDATION_ERROR');
    }

    await prisma.mou.delete({
      where: { id: mouId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/mous/:mouId/send - Send MOU email
hostRouter.post('/:partyId/mous/:mouId/send', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, mouId } = req.params;
    const { resend: forceResend, issuerName } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const mou = await prisma.mou.findFirst({
      where: { id: mouId, partyId },
      include: {
        party: { select: { name: true } },
        sponsor: { select: { id: true, name: true } },
      },
    });

    if (!mou) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    // Validate
    if (!mou.title || !mou.bodyMarkdown) {
      throw new AppError('MOU must have a title and body', 400, 'VALIDATION_ERROR');
    }

    if (!mou.counterpartyEmail) {
      throw new AppError('MOU must have a counterparty email', 400, 'VALIDATION_ERROR');
    }

    // Prevent re-send unless explicitly forced
    if (['issued', 'viewed', 'signed'].includes(mou.status) && !forceResend) {
      throw new AppError('MOU already sent. Pass { resend: true } to re-send.', 400, 'ALREADY_SENT');
    }

    // Build MOU view URL
    const mouViewUrl = `https://rsv.pizza/mou/${mou.viewToken}`;

    const effectiveDateText = mou.effectiveDate
      ? new Date(mou.effectiveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    // Build email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${mou.title}</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ffffff; font-size: 26px; margin: 0 0 10px 0;">${mou.title}</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">${mou.party.name}</p>
          </div>

          <div style="background: #f9f9f9; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
            <p style="margin: 0 0 16px 0; font-size: 16px;">
              ${mou.counterpartyCompany || mou.sponsor.name}, please review and sign the Memorandum of Understanding below.
            </p>

            <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
              <strong>MOU #${mou.mouNumber}</strong>
            </p>

            ${effectiveDateText ? `
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
                <strong>Effective:</strong> ${effectiveDateText}
              </p>
            ` : ''}

            ${mou.termText ? `
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
                <strong>Term:</strong> ${mou.termText}
              </p>
            ` : ''}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${mouViewUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Sign</a>
          </div>

          <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
            <p>Sent via <a href="https://rsv.pizza" style="color: #ff393a; text-decoration: none;">RSV.Pizza</a></p>
          </div>
        </body>
      </html>
    `;

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      const emailPayload: any = {
        from: 'RSV.Pizza <noreply@rsv.pizza>',
        to: [mou.counterpartyEmail],
        subject: `${mou.title} - ${mou.counterpartyCompany || mou.sponsor.name} - ${mou.party.name}`,
        html: emailHtml,
      };

      // Add CC recipients
      if (mou.ccEmails && mou.ccEmails.length > 0) {
        emailPayload.cc = mou.ccEmails;
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Resend API error:', error);
        throw new AppError(`Failed to send email: ${error}`, 500, 'EMAIL_ERROR');
      }
    } else {
      console.warn('RESEND_API_KEY not configured, skipping email send');
    }

    // Update MOU status (record optional issuer counter-sign)
    const updatedMou = await prisma.mou.update({
      where: { id: mouId },
      data: {
        status: 'issued',
        sentAt: new Date(),
        ...(issuerName ? { issuerName, issuerSignedAt: new Date() } : {}),
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    res.json({ mou: updatedMou, emailSent: !!resendApiKey });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Public routes (mounted at /api/mou)
// ============================================
const publicRouter = Router();

// GET /api/mou/:viewToken - Public MOU view
publicRouter.get('/:viewToken', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;

    const mou = await prisma.mou.findUnique({
      where: { viewToken },
      include: {
        party: { select: { name: true, eventImageUrl: true } },
        sponsor: { select: { name: true, logoUrl: true } },
      },
    });

    if (!mou) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    // Projection: omit internal-only fields (signerIp)
    const { signerIp, ...publicMou } = mou;

    res.json({ mou: publicMou });
  } catch (error) {
    next(error);
  }
});

// POST /api/mou/:viewToken/record-view - Record first view timestamp
publicRouter.post('/:viewToken/record-view', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;

    const mou = await prisma.mou.findUnique({
      where: { viewToken },
    });

    if (!mou) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    // Only record first view
    if (!mou.viewedAt) {
      await prisma.mou.update({
        where: { id: mou.id },
        data: {
          viewedAt: new Date(),
          status: mou.status === 'issued' ? 'viewed' : mou.status,
        },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/mou/:viewToken/sign - Recipient e-signs (public, token-gated)
publicRouter.post('/:viewToken/sign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;
    const { signerName, agree } = req.body;

    if (!signerName || !signerName.trim()) {
      throw new AppError('Signer name is required', 400, 'VALIDATION_ERROR');
    }

    if (agree !== true) {
      throw new AppError('You must agree to the terms to sign', 400, 'VALIDATION_ERROR');
    }

    const mou = await prisma.mou.findUnique({
      where: { viewToken },
    });

    if (!mou) {
      throw new AppError('MOU not found', 404, 'NOT_FOUND');
    }

    if (mou.status === 'signed') {
      throw new AppError('This MOU has already been signed', 400, 'INVALID_STATUS');
    }

    // Only allow signing on issued or viewed MOUs
    if (!['issued', 'viewed'].includes(mou.status)) {
      throw new AppError(`Cannot sign an MOU with status "${mou.status}"`, 400, 'INVALID_STATUS');
    }

    // Capture client IP
    const signerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || null;

    const updatedMou = await prisma.mou.update({
      where: { id: mou.id },
      data: {
        status: 'signed',
        signerName: signerName.trim(),
        signerEmail: mou.counterpartyEmail,
        signedAt: new Date(),
        signerIp,
      },
      include: {
        party: { select: { name: true, eventImageUrl: true } },
        sponsor: { select: { name: true, logoUrl: true } },
      },
    });

    // Projection: omit internal-only fields (signerIp)
    const { signerIp: _omit, ...publicMou } = updatedMou;

    res.json({ mou: publicMou });
  } catch (error) {
    next(error);
  }
});

export { hostRouter as mouHostRoutes, publicRouter as mouPublicRoutes };
