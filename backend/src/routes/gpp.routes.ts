import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { getAutoCoHostPartners, addPartnerToParty } from '../helpers/partnerSync.js';

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
  const easternEurope = ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'UA', 'BY', 'MD', 'LT', 'LV', 'EE', 'GE', 'AM', 'AZ', 'GR', 'CY', 'TR', 'RU'];
  if (easternEurope.includes(cc)) return 'eastern-europe';

  // India
  if (cc === 'IN') return 'india';

  // China
  if (cc === 'CN' || cc === 'HK' || cc === 'MO' || cc === 'TW') return 'china';

  // Middle East
  const middleEast = ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'IR', 'SY', 'JO', 'LB', 'IL', 'PS', 'EG'];
  if (middleEast.includes(cc)) return 'middle-east';

  // West Africa
  const westAfrica = ['NG', 'GH', 'SN', 'CI', 'CM', 'ML', 'BF', 'NE', 'TD', 'GN', 'BJ', 'TG', 'SL', 'LR', 'MR', 'GA', 'CG', 'CF', 'GQ', 'ST', 'CV', 'GM', 'GW'];
  if (westAfrica.includes(cc)) return 'west-africa';

  // East Africa (includes North African countries)
  const eastAfrica = ['KE', 'ET', 'TZ', 'UG', 'RW', 'MZ', 'MG', 'MW', 'DJ', 'ER', 'SO', 'SD', 'SS', 'CD', 'KM', 'SC', 'MU', 'TN', 'DZ', 'MA', 'LY', 'BI'];
  if (eastAfrica.includes(cc)) return 'east-africa';

  // South Africa
  const southAfrica = ['ZA', 'AO', 'ZW', 'ZM', 'BW', 'NA', 'LS', 'SZ'];
  if (southAfrica.includes(cc)) return 'south-africa';

  // Oceania
  const oceania = ['AU', 'NZ', 'FJ', 'PG', 'WS', 'TO', 'VU', 'SB', 'KI', 'FM', 'MH', 'PW', 'TV', 'NR', 'GU', 'NC', 'PF'];
  if (oceania.includes(cc)) return 'oceania';

  // Asia (catch-all for remaining Asian countries)
  const asia = ['JP', 'KR', 'TH', 'VN', 'PH', 'MY', 'SG', 'ID', 'MM', 'KH', 'LA', 'BN', 'TL', 'MN', 'KZ', 'UZ', 'TM', 'KG', 'TJ', 'AF', 'PK', 'BD', 'LK', 'NP', 'BT'];
  if (asia.includes(cc)) return 'asia';

  return null; // Unknown country
}

// Fallback: map country NAMES to regions when countryCode is missing
function countryNameToRegion(country: string): string | null {
  const name = country.toLowerCase().trim();
  const map: Record<string, string> = {
    'united states': 'usa', 'usa': 'usa',
    'canada': 'canada',
    'mexico': 'central-america', 'guatemala': 'central-america', 'honduras': 'central-america',
    'el salvador': 'central-america', 'nicaragua': 'central-america', 'costa rica': 'central-america',
    'panama': 'central-america', 'cuba': 'central-america', 'jamaica': 'central-america',
    'haiti': 'central-america', 'dominican republic': 'central-america', 'puerto rico': 'central-america',
    'trinidad and tobago': 'central-america', 'bahamas': 'central-america',
    'brazil': 'south-america', 'argentina': 'south-america', 'chile': 'south-america',
    'colombia': 'south-america', 'peru': 'south-america', 'venezuela': 'south-america',
    'ecuador': 'south-america', 'bolivia': 'south-america', 'paraguay': 'south-america',
    'uruguay': 'south-america', 'guyana': 'south-america', 'suriname': 'south-america',
    'united kingdom': 'western-europe', 'france': 'western-europe', 'germany': 'western-europe',
    'deutschland': 'western-europe', 'italy': 'western-europe', 'italia': 'western-europe',
    'spain': 'western-europe', 'portugal': 'western-europe', 'netherlands': 'western-europe',
    'belgium': 'western-europe', 'luxembourg': 'western-europe', 'ireland': 'western-europe',
    'austria': 'western-europe', 'switzerland': 'western-europe', 'denmark': 'western-europe',
    'norway': 'western-europe', 'sweden': 'western-europe', 'finland': 'western-europe',
    'iceland': 'western-europe', 'malta': 'western-europe', 'monaco': 'western-europe',
    'russia': 'eastern-europe', 'poland': 'eastern-europe', 'czechia': 'eastern-europe',
    'czech republic': 'eastern-europe', 'slovakia': 'eastern-europe', 'hungary': 'eastern-europe',
    'romania': 'eastern-europe', 'bulgaria': 'eastern-europe', 'croatia': 'eastern-europe',
    'slovenia': 'eastern-europe', 'serbia': 'eastern-europe', 'bosnia and herzegovina': 'eastern-europe',
    'montenegro': 'eastern-europe', 'north macedonia': 'eastern-europe', 'macedonia': 'eastern-europe',
    'albania': 'eastern-europe', 'ukraine': 'eastern-europe', 'belarus': 'eastern-europe',
    'moldova': 'eastern-europe', 'lithuania': 'eastern-europe', 'latvia': 'eastern-europe',
    'estonia': 'eastern-europe', 'georgia': 'eastern-europe', 'armenia': 'eastern-europe',
    'azerbaijan': 'eastern-europe', 'greece': 'eastern-europe', 'cyprus': 'eastern-europe',
    'turkey': 'eastern-europe',
    'india': 'india',
    'china': 'china', 'taiwan': 'china', 'hong kong': 'china',
    'saudi arabia': 'middle-east', 'united arab emirates': 'middle-east', 'uae': 'middle-east',
    'qatar': 'middle-east', 'kuwait': 'middle-east', 'bahrain': 'middle-east',
    'oman': 'middle-east', 'yemen': 'middle-east', 'iraq': 'middle-east',
    'iran': 'middle-east', 'syria': 'middle-east', 'jordan': 'middle-east',
    'lebanon': 'middle-east', 'israel': 'middle-east', 'egypt': 'middle-east',
    'nigeria': 'west-africa', 'ghana': 'west-africa', 'senegal': 'west-africa',
    "côte d'ivoire": 'west-africa', 'ivory coast': 'west-africa', 'cameroon': 'west-africa',
    'mali': 'west-africa', 'burkina faso': 'west-africa', 'niger': 'west-africa',
    'benin': 'west-africa', 'togo': 'west-africa', 'sierra leone': 'west-africa',
    'liberia': 'west-africa', 'guinea': 'west-africa',
    'kenya': 'east-africa', 'ethiopia': 'east-africa', 'tanzania': 'east-africa',
    'uganda': 'east-africa', 'rwanda': 'east-africa', 'mozambique': 'east-africa',
    'madagascar': 'east-africa', 'malawi': 'east-africa', 'burundi': 'east-africa',
    'somalia': 'east-africa', 'sudan': 'east-africa', 'south sudan': 'east-africa',
    'drc': 'east-africa', 'congo': 'east-africa', 'tunisia': 'east-africa',
    'algeria': 'east-africa', 'morocco': 'east-africa', 'libya': 'east-africa',
    'south africa': 'south-africa', 'zimbabwe': 'south-africa', 'zambia': 'south-africa',
    'botswana': 'south-africa', 'namibia': 'south-africa', 'angola': 'south-africa',
    'australia': 'oceania', 'new zealand': 'oceania',
    'japan': 'asia', 'south korea': 'asia', 'korea': 'asia',
    'thailand': 'asia', 'vietnam': 'asia', 'philippines': 'asia',
    'malaysia': 'asia', 'singapore': 'asia', 'indonesia': 'asia',
    'cambodia': 'asia', 'laos': 'asia', 'myanmar': 'asia',
    'mongolia': 'asia', 'kazakhstan': 'asia', 'pakistan': 'asia',
    'bangladesh': 'asia', 'sri lanka': 'asia', 'nepal': 'asia',
    'afghanistan': 'asia', 'bhutan': 'asia',
  };
  return map[name] || null;
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
  eventTags: ['Global Pizza Party', 'wpc', 'ens'],
  requireApproval: true,
  hideGuests: false,
  photosEnabled: true,
  photosPublic: true,
  eventImageUrl: 'https://www.rsv.pizza/gpp-flyer-2026-og.jpg',
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
    const { city, hostName, email, telegram, country, countryCode, cityLat, cityLng, timezone } = req.body;

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
    if (!telegram || typeof telegram !== 'string' || telegram.trim().length === 0) {
      throw new AppError('Telegram username is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCity = city.trim();
    const normalizedHostName = hostName.trim();
    const normalizedTelegram = telegram?.trim().replace(/^@/, '') || null;

    // Generate custom URL from city name (strip diacritics, lowercase, no spaces/special chars)
    const customUrl = normalizedCity
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    // Check for existing GPP event in this city
    const existingEvent = await prisma.party.findFirst({
      where: {
        customUrl,
        eventType: 'gpp',
      },
      select: {
        id: true,
        name: true,
        customUrl: true,
        inviteCode: true,
      },
    });

    if (existingEvent) {
      const eventUrl = existingEvent.customUrl
        ? `https://rsv.pizza/${existingEvent.customUrl}`
        : `https://rsv.pizza/${existingEvent.inviteCode}`;

      throw new AppError(
        `This city's Global Pizza Party has already been created! Visit the event page: ${eventUrl}`,
        409,
        'DUPLICATE_CITY'
      );
    }

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
          telegram: normalizedTelegram,
        },
      });
    } else if (normalizedTelegram) {
      // Update existing user's telegram if provided
      await prisma.user.update({
        where: { id: user.id },
        data: { telegram: normalizedTelegram },
      });
    }

    // Generate event name with city (no dash, just space)
    const eventName = `Global Pizza Party ${normalizedCity}`;

    // Calculate default date: May 22 of current or next year, 6-9 PM in event timezone
    const now = new Date();
    let defaultYear = now.getUTCFullYear();
    const may22 = new Date(Date.UTC(defaultYear, 4, 22));
    if (now > may22) {
      defaultYear++;
    }

    const eventTimezone = (typeof timezone === 'string' && timezone.trim()) || 'America/New_York';

    // Convert a local time in a timezone to UTC
    function localToUTC(year: number, month: number, day: number, hour: number, tz: string): Date {
      const utcGuess = new Date(Date.UTC(year, month, day, hour, 0, 0));
      const fmt = (timeZone: string) => new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const parse = (str: string) => {
        const m = str.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
        return m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]) : 0;
      };
      const offset = parse(fmt(tz).format(utcGuess)) - parse(fmt('UTC').format(utcGuess));
      return new Date(utcGuess.getTime() - offset);
    }

    const defaultDate = localToUTC(defaultYear, 4, 22, 18, eventTimezone);    // 6 PM local
    const defaultEndDate = localToUTC(defaultYear, 4, 22, 21, eventTimezone); // 9 PM local

    // Auto-infer region from country code, falling back to country name
    const inferredRegion = (countryCode ? countryCodeToRegion(countryCode) : null)
      || (country ? countryNameToRegion(country) : null);

    // Find active underbosses for the inferred region and add as hidden co-hosts
    let underbossCoHosts: any[] = [];
    if (inferredRegion) {
      const underbosses = await prisma.underboss.findMany({
        where: {
          isActive: true,
          OR: [{ region: inferredRegion }, { regions: { has: inferredRegion } }],
        },
        select: { name: true, email: true },
      });
      underbossCoHosts = underbosses.map(ub => ({
        id: crypto.randomUUID(),
        name: ub.name,
        email: ub.email.toLowerCase(),
        showOnEvent: false,
        canEdit: true,
        isUnderboss: true,
      }));
    }

    // Read DB-stored default description, fall back to hardcoded
    const configRow = await prisma.appConfig.findUnique({ where: { key: 'gpp_default_description' } });
    const gppDescription = configRow?.value ?? GPP_DEFAULTS.description;

    // Create the party with GPP defaults
    const party = await prisma.party.create({
      data: {
        name: eventName,
        description: gppDescription,
        eventType: GPP_DEFAULTS.eventType,
        eventTags: GPP_DEFAULTS.eventTags,
        requireApproval: GPP_DEFAULTS.requireApproval,
        hideGuests: GPP_DEFAULTS.hideGuests,
        photosEnabled: GPP_DEFAULTS.photosEnabled,
        photosPublic: GPP_DEFAULTS.photosPublic,
        eventImageUrl: GPP_DEFAULTS.eventImageUrl,
        customUrl: customUrl,
        date: defaultDate,
        endTime: defaultEndDate,
        duration: 3,
        timezone: eventTimezone,
        region: inferredRegion,
        country: country || null,
        availableBeverages: [],
        availableToppings: [],
        coHosts: [
          {
            id: crypto.randomUUID(),
            name: 'PizzaDAO',
            email: 'hello@rarepizzas.com',
            showOnEvent: true
          },
          {
            id: crypto.randomUUID(),
            name: normalizedHostName,
            email: normalizedEmail,
            showOnEvent: false,
            canEdit: true
          },
          ...underbossCoHosts,
        ],
        userId: user.id,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Auto-sync partner co-hosts + sponsors for default tags
    try {
      const partners = await getAutoCoHostPartners(GPP_DEFAULTS.eventTags);
      for (const partner of partners) {
        await addPartnerToParty(party as any, partner);
      }
    } catch (err) {
      console.error('Failed to sync auto partners:', err);
    }

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

// Shared select for GPP event queries
const gppEventSelect = {
  id: true,
  name: true,
  inviteCode: true,
  customUrl: true,
  date: true,
  endTime: true,
  timezone: true,
  address: true,
  venueName: true,
  country: true,
  region: true,
  latitude: true,
  longitude: true,
  eventImageUrl: true,
  eventType: true,
  eventTags: true,
  underbossStatus: true,
  rsvpClosedAt: true,
  createdAt: true,
  _count: {
    select: { guests: true },
  },
  user: {
    select: { name: true },
  },
} as const;

// Format a Party record into the public GPP API response
function formatGppEvent(event: any) {
  const baseUrl = 'https://rsv.pizza';
  const url = event.customUrl
    ? `${baseUrl}/${event.customUrl}`
    : `${baseUrl}/${event.inviteCode}`;
  const city = event.name?.replace(/^Global Pizza Party\s*/i, '').trim() || event.name;

  return {
    id: event.id,
    name: event.name,
    city,
    customUrl: event.customUrl,
    inviteCode: event.inviteCode,
    url,
    date: event.date,
    endTime: event.endTime,
    timezone: event.timezone,
    country: event.country,
    region: event.region,
    address: event.address,
    venueName: event.venueName,
    latitude: event.latitude,
    longitude: event.longitude,
    eventImageUrl: event.eventImageUrl,
    eventType: event.eventType,
    eventTags: event.eventTags,
    createdAt: event.createdAt,
    hostName: 'PizzaDAO',
    guestCount: event._count?.guests ?? 0,
    underbossStatus: event.underbossStatus || 'pending',
    approved: event.underbossStatus === 'approved',
    community: event.underbossStatus === 'listed',
    rsvpOpen: !event.rsvpClosedAt,
  };
}

// GET /api/gpp/events/by-city/:citySlug - Look up a single GPP event by custom URL slug
router.get('/events/by-city/:citySlug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { citySlug } = req.params;

    let event = await prisma.party.findFirst({
      where: {
        eventType: 'gpp',
        customUrl: citySlug.toLowerCase(),
      },
      select: gppEventSelect,
    });

    // Alias fallback: check if this is an old slug
    if (!event) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: citySlug.toLowerCase() },
        select: { partyId: true },
      });
      if (alias) {
        event = await prisma.party.findFirst({
          where: {
            id: alias.partyId,
            eventType: 'gpp',
          },
          select: gppEventSelect,
        });
      }
    }

    if (!event) {
      return res.status(404).json({ error: 'GPP event not found for this city' });
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ event: formatGppEvent(event) });
  } catch (error) {
    next(error);
  }
});

// GET /api/gpp/events - List all GPP events (for admin/public listing)
router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '500', offset = '0', city, country, region } = req.query;

    const where: any = { eventType: 'gpp', underbossStatus: { notIn: ['rejected', 'hidden'] } };
    if (city) {
      where.name = { contains: city as string, mode: 'insensitive' };
    }
    if (country) {
      where.country = { contains: country as string, mode: 'insensitive' };
    }
    if (region) {
      where.region = region as string;
    }

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 500, 500);
    const parsedOffset = parseInt(offset as string, 10) || 0;

    const [events, total] = await Promise.all([
      prisma.party.findMany({
        where,
        select: gppEventSelect,
        orderBy: { createdAt: 'desc' },
        take: parsedLimit,
        skip: parsedOffset,
      }),
      prisma.party.count({ where }),
    ]);

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      events: events.map(formatGppEvent),
      total,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/gpp/pizzerias - All GPP pizzerias (flattened across events)
router.get('/pizzerias', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: any = {
      eventType: 'gpp',
      selectedPizzerias: { not: Prisma.DbNull },
      underbossStatus: { notIn: ['rejected', 'hidden'] },
    };

    const parties = await prisma.party.findMany({
      where,
      select: {
        id: true,
        name: true,
        customUrl: true,
        inviteCode: true,
        address: true,
        selectedPizzerias: true,
      },
    });

    // Flatten: for each event, for each pizzeria, emit { ...pizzeria, eventCity, eventSlug }
    const pizzerias: any[] = [];
    for (const party of parties) {
      const raw = party.selectedPizzerias;
      if (!Array.isArray(raw)) continue;
      // Extract city from party name (GPP events are named like "Global Pizza Party CityName")
      const eventCity = party.name?.replace(/^Global Pizza Party\s*/i, '').trim() || 'Unknown';
      const eventSlug = party.customUrl || party.inviteCode;

      for (const p of raw as any[]) {
        // Strip heavy fields, keep photoUrl if previously cached
        const { photos, orderingOptions, ...light } = p;
        pizzerias.push({ ...light, eventId: party.id, eventCity, eventSlug });
      }
    }

    res.set('Cache-Control', 'public, max-age=600');
    res.json(pizzerias);
  } catch (err) {
    console.error('Error fetching GPP pizzerias:', err);
    res.status(500).json({ error: 'Failed to fetch pizzerias' });
  }
});

// PATCH /api/gpp/pizzerias/:partyId/photo - Cache a pizzeria photo URL
router.patch('/pizzerias/:partyId/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { placeId, photoUrl } = req.body;

    if (!placeId || !photoUrl) {
      return res.status(400).json({ error: 'placeId and photoUrl required' });
    }

    // Only accept Google Maps photo URLs
    if (!photoUrl.startsWith('https://lh3.googleusercontent.com/') && !photoUrl.startsWith('https://maps.googleapis.com/')) {
      return res.status(400).json({ error: 'Invalid photo URL' });
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { selectedPizzerias: true },
    });

    if (!party || !Array.isArray(party.selectedPizzerias)) {
      return res.status(404).json({ error: 'Party not found' });
    }

    const pizzerias = party.selectedPizzerias as any[];
    let updated = false;
    for (let i = 0; i < pizzerias.length; i++) {
      if (pizzerias[i].placeId === placeId && !pizzerias[i].photoUrl) {
        pizzerias[i].photoUrl = photoUrl;
        updated = true;
        break;
      }
    }

    if (!updated) {
      return res.json({ ok: true, cached: false });
    }

    await prisma.party.update({
      where: { id: partyId },
      data: { selectedPizzerias: pizzerias },
    });

    res.json({ ok: true, cached: true });
  } catch (err) {
    console.error('Error caching pizzeria photo:', err);
    res.status(500).json({ error: 'Failed to cache photo' });
  }
});

export default router;
