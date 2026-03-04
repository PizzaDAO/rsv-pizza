import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// Map ISO country codes to underboss regions
function countryCodeToRegion(countryCode: string): string | null {
  const cc = countryCode.toUpperCase();

  // USA
  if (cc === 'US') return 'usa';

  // Canada
  if (cc === 'CA') return 'canada';

  // Central America
  const centralAmerica = ['MX', 'GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'PR', 'TT', 'BB', 'BS', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC'];
  if (centralAmerica.includes(cc)) return 'central-america';

  // South America
  const southAmerica = ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'GF'];
  if (southAmerica.includes(cc)) return 'south-america';

  // Western Europe
  const westernEurope = ['GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'IE', 'AT', 'CH', 'DK', 'NO', 'SE', 'FI', 'IS', 'MT', 'MC', 'AD', 'LI', 'SM', 'VA'];
  if (westernEurope.includes(cc)) return 'western-europe';

  // Eastern Europe
  const easternEurope = ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'UA', 'BY', 'MD', 'LT', 'LV', 'EE', 'GE', 'AM', 'AZ', 'GR', 'CY', 'TR'];
  if (easternEurope.includes(cc)) return 'eastern-europe';

  // India
  if (cc === 'IN') return 'india';

  // China
  if (cc === 'CN' || cc === 'HK' || cc === 'MO' || cc === 'TW') return 'china';

  // Middle East
  const middleEast = ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'IR', 'SY', 'JO', 'LB', 'IL', 'PS', 'EG'];
  if (middleEast.includes(cc)) return 'middle-east';

  // Africa (excluding Egypt which is in Middle East)
  const africa = ['ZA', 'NG', 'KE', 'GH', 'ET', 'TZ', 'UG', 'RW', 'SN', 'CI', 'CM', 'AO', 'MZ', 'MG', 'ZW', 'ZM', 'BW', 'NA', 'MW', 'ML', 'BF', 'NE', 'TD', 'GN', 'BJ', 'TG', 'SL', 'LR', 'MR', 'GA', 'CG', 'CD', 'DJ', 'ER', 'SO', 'SD', 'SS', 'CF', 'GQ', 'ST', 'KM', 'SC', 'MU', 'CV', 'GM', 'GW', 'LS', 'SZ', 'TN', 'DZ', 'MA', 'LY'];
  if (africa.includes(cc)) return 'africa';

  // Oceania
  const oceania = ['AU', 'NZ', 'FJ', 'PG', 'WS', 'TO', 'VU', 'SB', 'KI', 'FM', 'MH', 'PW', 'TV', 'NR', 'GU', 'NC', 'PF'];
  if (oceania.includes(cc)) return 'oceania';

  // Asia (catch-all for remaining Asian countries)
  const asia = ['JP', 'KR', 'TH', 'VN', 'PH', 'MY', 'SG', 'ID', 'MM', 'KH', 'LA', 'BN', 'TL', 'MN', 'KZ', 'UZ', 'TM', 'KG', 'TJ', 'AF', 'PK', 'BD', 'LK', 'NP', 'BT'];
  if (asia.includes(cc)) return 'asia';

  return null; // Unknown country
}

// GPP Default values
const GPP_DEFAULTS = {
  description: `Join us for the Global Pizza Party, a worldwide celebration of pizza and bitcoin, where communities around the world come together to share pizza and good vibes.

What to expect:
- Free pizza
- Crypto enthusiasts
- Good conversations

RSVP to secure your slice!`,
  eventType: 'gpp',
  eventTags: ['Global Pizza Party'],
  requireApproval: true,
  hideGuests: false,
  photosEnabled: true,
  photosPublic: true,
};

// Helper function to send GPP welcome email with magic link
async function sendGPPWelcomeEmail(
  email: string,
  hostName: string,
  eventName: string,
  hostPageUrl: string,
  code: string
) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured - skipping email');
    return;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Global Pizza Party is Live!</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 28px; margin: 0 0 10px 0;">Your Global Pizza Party is Live!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">${eventName}</p>
        </div>

        <p style="font-size: 16px; margin-bottom: 20px;">
          Hey ${hostName}!
        </p>

        <p style="font-size: 16px; margin-bottom: 20px;">
          Your Global Pizza Party event has been created and is ready for guests! You're now part of a worldwide celebration of pizza.
        </p>

        <div style="background: #f9f9f9; padding: 30px 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
          <p style="margin: 0 0 15px 0; font-size: 14px; color: #666; font-weight: 600;">YOUR SIGN-IN CODE</p>
          <div style="font-size: 48px; font-weight: 700; letter-spacing: 8px; color: #ff393a; margin: 10px 0;">${code}</div>
          <p style="margin: 15px 0 0 0; font-size: 13px; color: #999;">Use this code to access your host dashboard</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${hostPageUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Go to Host Dashboard
          </a>
        </div>

        <div style="background: #fff4e6; padding: 20px; border-radius: 12px; margin: 30px 0;">
          <h3 style="margin: 0 0 10px 0; color: #ff6b35; font-size: 16px;">Next Steps:</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li>Add your event date, time, and location</li>
            <li>Upload a custom event image</li>
            <li>Share your event link with friends</li>
            <li>Review and approve RSVPs as they come in</li>
          </ul>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
          <p>Questions? Reply to this email or reach out on <a href="https://t.me/pizzadao" style="color: #ff393a;">Telegram</a>.</p>
          <p style="margin-top: 20px;">
            Happy hosting!<br>
            The PizzaDAO Team
          </p>
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
      to: [email],
      subject: `Your Global Pizza Party is Live! - ${eventName}`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return response.json();
}

// POST /api/gpp/events - Create a GPP event (simplified flow, no auth required)
router.post('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { city, hostName, email, country, countryCode, cityLat, cityLng } = req.body;

    // Validate required fields
    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      throw new AppError('City is required', 400, 'VALIDATION_ERROR');
    }
    if (!hostName || typeof hostName !== 'string' || hostName.trim().length === 0) {
      throw new AppError('Host name is required', 400, 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError('Valid email is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCity = city.trim();
    const normalizedHostName = hostName.trim();

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedHostName,
        },
      });
    }

    // Generate event name with city (no dash, just space)
    const eventName = `Global Pizza Party ${normalizedCity}`;

    // Generate custom URL from city name (lowercase, no spaces)
    const customUrl = normalizedCity.toLowerCase().replace(/\s+/g, '');

    // Calculate default date: May 22 of current or next year
    const now = new Date();
    let defaultYear = now.getFullYear();
    const may22 = new Date(defaultYear, 4, 22); // Month is 0-indexed, so 4 = May
    if (now > may22) {
      defaultYear++; // If May 22 has passed, use next year
    }
    const defaultDate = new Date(defaultYear, 4, 22, 18, 0, 0); // May 22 at 6 PM

    // Auto-infer region from country code
    const inferredRegion = countryCode ? countryCodeToRegion(countryCode) : null;

    // Create the party with GPP defaults
    const party = await prisma.party.create({
      data: {
        name: eventName,
        description: GPP_DEFAULTS.description,
        eventType: GPP_DEFAULTS.eventType,
        eventTags: GPP_DEFAULTS.eventTags,
        requireApproval: GPP_DEFAULTS.requireApproval,
        hideGuests: GPP_DEFAULTS.hideGuests,
        photosEnabled: GPP_DEFAULTS.photosEnabled,
        photosPublic: GPP_DEFAULTS.photosPublic,
        customUrl: customUrl,
        date: defaultDate,
        region: inferredRegion,
        availableBeverages: [],
        availableToppings: [],
        coHosts: [
          {
            id: crypto.randomUUID(),
            name: normalizedHostName,
            email: normalizedEmail,
            showOnEvent: true
          },
          {
            id: crypto.randomUUID(),
            name: 'PizzaDAO',
            email: 'hello@rarepizzas.com',
            showOnEvent: true
          }
        ],
        userId: user.id,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Add the host as a guest
    await prisma.guest.create({
      data: {
        name: normalizedHostName,
        email: normalizedEmail,
        dietaryRestrictions: [],
        likedToppings: [],
        dislikedToppings: [],
        likedBeverages: [],
        dislikedBeverages: [],
        submittedVia: 'host',
        partyId: party.id,
        approved: true,
      },
    });

    // Create magic link for the user
    const token = randomBytes(32).toString('hex');

    // Generate unique 6-digit code
    let code = '';
    let codeExists = true;
    while (codeExists) {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await prisma.magicLink.findUnique({ where: { code } });
      codeExists = !!existing;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days for GPP

    await prisma.magicLink.create({
      data: {
        token,
        code,
        email: normalizedEmail,
        expiresAt,
        userId: user.id,
      },
    });

    // Build URLs
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5176';
    const hostPageUrl = `${baseUrl}/host/${party.inviteCode}`;
    const eventPageUrl = party.customUrl
      ? `${baseUrl}/${party.customUrl}`
      : `${baseUrl}/${party.inviteCode}`;

    // Send welcome email with magic link
    try {
      await sendGPPWelcomeEmail(
        normalizedEmail,
        normalizedHostName,
        eventName,
        hostPageUrl,
        code
      );
    } catch (emailError) {
      console.error('Failed to send GPP welcome email:', emailError);
      // Don't fail the request if email fails
    }

    // Log for development
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n========================================');
      console.log('GPP Event Created (dev mode):');
      console.log('Host Page:', hostPageUrl);
      console.log('Login Code:', code);
      console.log('========================================\n');
    }

    res.status(201).json({
      success: true,
      event: {
        id: party.id,
        name: party.name,
        inviteCode: party.inviteCode,
        eventType: party.eventType,
        eventTags: party.eventTags,
      },
      hostPageUrl,
      eventPageUrl,
      message: 'Your Global Pizza Party event has been created! Check your email for a login link.',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/gpp/events - List all GPP events (for admin/public listing)
router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50', offset = '0' } = req.query;

    const events = await prisma.party.findMany({
      where: {
        eventType: 'gpp',
      },
      select: {
        id: true,
        name: true,
        inviteCode: true,
        customUrl: true,
        date: true,
        address: true,
        venueName: true,
        eventImageUrl: true,
        eventType: true,
        eventTags: true,
        createdAt: true,
        _count: {
          select: { guests: true },
        },
        user: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit as string, 10), 100),
      skip: parseInt(offset as string, 10),
    });

    const total = await prisma.party.count({
      where: { eventType: 'gpp' },
    });

    res.json({
      events: events.map(event => ({
        ...event,
        hostName: event.user?.name || null,
        guestCount: event._count.guests,
        user: undefined,
        _count: undefined,
      })),
      total,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
