import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/rsvp/:inviteCode - Get party info for RSVP page (public)
router.get('/:inviteCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        availableBeverages: true,
        rsvpClosedAt: true,
        maxGuests: true,
        user: { select: { name: true } },
        _count: {
          select: { guests: true },
        },
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          availableBeverages: true,
          rsvpClosedAt: true,
          maxGuests: true,
          user: { select: { name: true } },
          _count: {
            select: { guests: true },
          },
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const hostName = party.user?.name || null;

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      return res.json({
        party: {
          name: party.name,
          date: party.date,
          hostName,
        },
        rsvpClosed: true,
        message: 'RSVPs are no longer being accepted for this party',
      });
    }

    // Check if max guests reached
    if (party.maxGuests && party._count.guests >= party.maxGuests) {
      return res.json({
        party: {
          name: party.name,
          date: party.date,
          hostName,
        },
        rsvpClosed: true,
        message: 'This party has reached its maximum number of guests',
      });
    }

    res.json({
      party: {
        name: party.name,
        date: party.date,
        hostName,
        availableBeverages: party.availableBeverages,
        guestCount: party._count.guests,
        maxGuests: party.maxGuests,
      },
      rsvpClosed: false,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/rsvp/:inviteCode/guest/:email - Get existing guest by email (public)
router.get('/:inviteCode/guest/:email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, email } = req.params;

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: { id: true },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: { id: true },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Find guest by party ID and email
    const guest = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: email.toLowerCase(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        ethereumAddress: true,
        roles: true,
        mailingListOptIn: true,
        dietaryRestrictions: true,
        likedToppings: true,
        dislikedToppings: true,
        likedBeverages: true,
        dislikedBeverages: true,
        pizzeriaRankings: true,
      },
    });

    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    res.json({ guest });
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/guest - Submit guest preferences (public)
router.post('/:inviteCode/guest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const {
      name,
      email,
      ethereumAddress,
      roles,
      mailingListOptIn,
      dietaryRestrictions,
      likedToppings,
      dislikedToppings,
      likedBeverages,
      dislikedBeverages,
      pizzeriaRankings
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate Ethereum address or ENS name format if provided
    if (ethereumAddress && ethereumAddress.trim()) {
      const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
      const ensRegex = /^[a-zA-Z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;
      const trimmedAddress = ethereumAddress.trim();
      if (!ethAddressRegex.test(trimmedAddress) && !ensRegex.test(trimmedAddress)) {
        throw new AppError('Invalid Ethereum address or ENS name format', 400, 'VALIDATION_ERROR');
      }
    }

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError('Invalid email format', 400, 'VALIDATION_ERROR');
      }
    }

    // Find party by invite code OR custom URL (frontend supports both)
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        address: true,
        customUrl: true,
        rsvpClosedAt: true,
        maxGuests: true,
        requireApproval: true,
        user: { select: { name: true } },
        _count: { select: { guests: true } },
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          address: true,
          customUrl: true,
          rsvpClosedAt: true,
          maxGuests: true,
          requireApproval: true,
          user: { select: { name: true } },
          _count: { select: { guests: true } },
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      throw new AppError('RSVPs are closed for this party', 400, 'RSVP_CLOSED');
    }

    // Check max guests
    if (party.maxGuests && party._count.guests >= party.maxGuests) {
      throw new AppError('Party has reached maximum guests', 400, 'MAX_GUESTS_REACHED');
    }

    // Check for duplicate email if email is provided
    if (email?.trim()) {
      const existingGuest = await prisma.guest.findFirst({
        where: {
          partyId: party.id,
          email: email.trim().toLowerCase(),
        },
      });

      if (existingGuest) {
        // Update the existing guest record
        const updatedGuest = await prisma.guest.update({
          where: { id: existingGuest.id },
          data: {
            name: name.trim(),
            ethereumAddress: ethereumAddress?.trim() || null,
            roles: roles || [],
            mailingListOptIn: mailingListOptIn || false,
            dietaryRestrictions: dietaryRestrictions || [],
            likedToppings: likedToppings || [],
            dislikedToppings: dislikedToppings || [],
            likedBeverages: likedBeverages || [],
            dislikedBeverages: dislikedBeverages || [],
            pizzeriaRankings: pizzeriaRankings || [],
          },
        });

        return res.status(200).json({
          success: true,
          updated: true,
          guest: {
            id: updatedGuest.id,
            name: updatedGuest.name,
          },
          message: 'Your RSVP has been updated!',
        });
      }
    }

    // Create guest
    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        ethereumAddress: ethereumAddress?.trim() || null,
        roles: roles || [],
        mailingListOptIn: mailingListOptIn || false,
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        pizzeriaRankings: pizzeriaRankings || [],
        submittedVia: 'link',
        partyId: party.id,
      },
    });

    // Send confirmation email if email provided
    if (email?.trim()) {
      try {
        await sendRSVPConfirmationEmail({
          guestEmail: email.trim(),
          guestName: name.trim(),
          guestId: guest.id,
          partyName: party.name,
          partyDate: party.date,
          partyAddress: party.address,
          inviteCode,
          customUrl: party.customUrl,
          requireApproval: party.requireApproval,
        });
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the RSVP if email fails
      }
    }

    res.status(201).json({
      success: true,
      guest: {
        id: guest.id,
        name: guest.name,
      },
      requireApproval: party.requireApproval,
      message: party.requireApproval
        ? 'Your RSVP has been submitted and is pending approval from the host.'
        : 'Your preferences have been saved!',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/send-confirmation - Send confirmation email for an RSVP
router.post('/:inviteCode/send-confirmation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { guestId, guestEmail, guestName } = req.body;

    if (!guestEmail || !guestName) {
      throw new AppError('Guest email and name are required', 400, 'VALIDATION_ERROR');
    }

    // Get party details (try invite code first, then custom URL)
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        address: true,
        customUrl: true,
      },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          address: true,
          customUrl: true,
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Send confirmation email
    await sendRSVPConfirmationEmail({
      guestEmail,
      guestName,
      guestId,
      partyName: party.name,
      partyDate: party.date,
      partyAddress: party.address,
      inviteCode,
      customUrl: party.customUrl,
    });

    res.json({ success: true, message: 'Confirmation email sent' });
  } catch (error) {
    next(error);
  }
});

// Helper function to send RSVP confirmation email
async function sendRSVPConfirmationEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId?: string;
  partyName: string;
  partyDate: Date | null;
  partyAddress: string | null;
  inviteCode: string;
  customUrl: string | null;
  requireApproval?: boolean;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const baseUrl = 'https://rsv.pizza';
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  // Generate unique check-in URL with guest ID
  const checkInUrl = params.guestId
    ? `${baseUrl}/checkin/${params.inviteCode}/${params.guestId}`
    : eventUrl;

  // Generate QR code using a free QR code API (encoded check-in URL)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkInUrl)}&bgcolor=f9f9f9&color=1a1a2e`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Date TBD';

  const addressText = params.partyAddress || 'Location TBD';

  // Different email content based on whether approval is required
  const isPendingApproval = params.requireApproval;

  const qrCodeSection = !isPendingApproval ? `
        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">Your Check-In QR Code</h3>
          <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Show this at the event for quick check-in</p>
          <img src="${qrCodeUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
          <p style="color: #999; font-size: 12px; margin-top: 15px;">Guest: ${params.guestName}</p>
        </div>
  ` : `
        <div style="background: #fff3cd; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0; margin-bottom: 15px;">Pending Host Approval</h3>
          <p style="color: #856404; font-size: 14px; margin: 0;">Your RSVP is pending approval from the host. You'll receive another email with your check-in QR code once approved.</p>
        </div>
  `;

  const headerTitle = isPendingApproval ? '🍕 RSVP Submitted!' : '🍕 You\'re Going!';
  const headerSubtitle = isPendingApproval ? 'Awaiting host approval' : 'Your RSVP is confirmed';
  const footerText = isPendingApproval
    ? `We'll let you know once the host approves your RSVP, ${params.guestName}!`
    : `See you there, ${params.guestName}!`;
  const emailSubject = isPendingApproval
    ? `RSVP Submitted for ${params.partyName} - Pending Approval`
    : `You're going to ${params.partyName}! 🍕`;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isPendingApproval ? 'RSVP Pending' : 'RSVP Confirmed'}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">${headerTitle}</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">${headerSubtitle}</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
          <p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>
        </div>

        ${qrCodeSection}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>${footerText}</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [params.guestEmail],
      subject: emailSubject,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return response.json();
}

// Helper function to send approval notification email with QR code
export async function sendApprovalEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId: string;
  partyName: string;
  partyDate: Date | null;
  partyAddress: string | null;
  inviteCode: string;
  customUrl: string | null;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const baseUrl = 'https://rsv.pizza';
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  // Generate unique check-in URL with guest ID
  const checkInUrl = `${baseUrl}/checkin/${params.inviteCode}/${params.guestId}`;

  // Generate QR code using a free QR code API (encoded check-in URL)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkInUrl)}&bgcolor=f9f9f9&color=1a1a2e`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Date TBD';

  const addressText = params.partyAddress || 'Location TBD';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RSVP Approved</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 You're Approved!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">Your RSVP has been confirmed</p>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #28a745;">
          <p style="color: #155724; font-size: 16px; margin: 0; font-weight: 600;">Great news! The host has approved your RSVP.</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
          <p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">Your Check-In QR Code</h3>
          <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Show this at the event for quick check-in</p>
          <img src="${qrCodeUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
          <p style="color: #999; font-size: 12px; margin-top: 15px;">Guest: ${params.guestName}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>See you there, ${params.guestName}!</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [params.guestEmail],
      subject: `You're approved for ${params.partyName}! 🍕`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return response.json();
}

export default router;
