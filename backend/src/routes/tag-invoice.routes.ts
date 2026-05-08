import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

const router = Router();

// ============================================
// Sponsorship pricing (ported from frontend)
// ============================================

const TIER_1_CITIES = [
  'new york', 'nyc', 'los angeles', 'san francisco', 'chicago', 'miami',
  'london', 'paris',
  'tokyo', 'singapore', 'hong kong', 'seoul', 'sydney', 'dubai',
  'shanghai', 'beijing', 'shenzhen',
  'istanbul', 'İstanbul',
  'delhi', 'new delhi', 'mumbai',
];

const TIER_2_CITIES = [
  'boston', 'washington', 'denver', 'seattle', 'austin', 'dallas', 'houston', 'atlanta', 'philadelphia',
  'san diego', 'las vegas', 'phoenix', 'nashville', 'minneapolis', 'detroit', 'portland',
  'kansas city', 'st. louis', 'salt lake city', 'pittsburgh', 'san juan', 'honolulu',
  'raleigh', 'cleveland', 'cincinnati', 'milwaukee', 'memphis', 'jacksonville', 'omaha',
  'toronto', 'vancouver', 'calgary', 'edmonton', 'ottawa', 'montreal', 'winnipeg',
  'mexico city', 'monterrey', 'sao paulo', 'rio de janeiro', 'buenos aires', 'bogota', 'bogotá',
  'lima', 'santiago', 'medellin', 'medellín', 'caracas', 'quito',
  'berlin', 'amsterdam', 'barcelona', 'lisbon', 'milan', 'munich', 'hamburg', 'rome', 'roma',
  'vienna', 'wien', 'prague', 'warsaw', 'warszawa', 'budapest', 'dublin', 'copenhagen',
  'stockholm', 'oslo', 'zurich', 'brussels', 'athens', 'helsinki', 'bucharest',
  'zagreb', 'ljubljana', 'gothenburg', 'tallinn', 'naples', 'moscow',
  'melbourne', 'bangkok', 'kuala lumpur', 'ho chi minh', 'hanoi', 'doha', 'beirut',
  'chennai', 'kolkata', 'hyderabad', 'bangalore', 'pune', 'colombo', 'kathmandu',
  'lagos', 'nairobi', 'johannesburg', 'kampala', 'dar es salaam', 'accra', 'addis ababa',
  'kigali', 'cape town',
  'perth', 'gold coast', 'auckland', 'wellington',
];

const TIER_CONFIG: Record<1 | 2 | 3, { floor: number; ceiling: number; max: number }> = {
  1: { floor: 25, ceiling: 150, max: 1000 },
  2: { floor: 25, ceiling: 100, max: 500 },
  3: { floor: 35, ceiling: 150, max: 400 },
};

function matchesList(cityName: string, list: string[]): boolean {
  const normalized = cityName.toLowerCase().replace(/[-\s]/g, '');
  return list.some((c) => normalized.includes(c.replace(/[-\s]/g, '')));
}

function getCityTier(cityName: string): 1 | 2 | 3 {
  if (matchesList(cityName, TIER_1_CITIES)) return 1;
  if (matchesList(cityName, TIER_2_CITIES)) return 2;
  return 3;
}

function calculateEventPrice(guests: number, cityName: string): number {
  const tier = getCityTier(cityName);
  const { floor, ceiling, max } = TIER_CONFIG[tier];
  const clamped = Math.max(floor, Math.min(ceiling, guests));
  const price = 200 + ((clamped - floor) / (ceiling - floor)) * (max - 200);
  return Math.round(price / 50) * 50;
}

// ============================================
// Admin auth middleware
// ============================================

async function requireAdminAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (error) {
    next(error);
  }
}

// All tag-invoice routes require auth + admin
router.use(requireAuth);
router.use(requireAdminAuth);

// ============================================
// GET /api/tag-invoices/events?tag=X
// List events for a tag with suggested pricing
// ============================================

router.get('/events', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tag = req.query.tag as string;
    if (!tag) {
      throw new AppError('Tag parameter is required', 400, 'BAD_REQUEST');
    }

    // Find events with this tag
    const events = await prisma.party.findMany({
      where: {
        eventTags: { has: tag },
      },
      select: {
        id: true,
        name: true,
        expectedGuests: true,
        _count: { select: { guests: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Find SponsorUser for this tag
    const sponsorUser = await prisma.sponsorUser.findFirst({
      where: { tag },
      select: {
        id: true,
        coHostName: true,
        email: true,
        name: true,
        coHostWebsite: true,
      },
    });

    const prefix = 'Global Pizza Party ';
    let suggestedTotal = 0;

    const eventData = events.map((event) => {
      const cityName = event.name.startsWith(prefix)
        ? event.name.slice(prefix.length)
        : event.name;
      const guests = event.expectedGuests ?? event._count.guests ?? 30;
      const suggestedPrice = calculateEventPrice(guests, cityName);
      suggestedTotal += suggestedPrice;

      return {
        id: event.id,
        name: event.name,
        city: cityName,
        expectedGuests: event.expectedGuests,
        guestCount: event._count.guests,
        suggestedPrice,
      };
    });

    res.json({
      tag,
      sponsorUser,
      events: eventData,
      suggestedTotal,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/tag-invoices
// Create a tag-based invoice
// ============================================

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      tag,
      lineItems,
      paymentTerms,
      paymentInstructions,
      memo,
      dueDate,
      billToCompany,
      billToContact,
      billToEmail,
      billToAddress,
      ccEmails,
    } = req.body;

    if (!tag) {
      throw new AppError('Tag is required', 400, 'BAD_REQUEST');
    }
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new AppError('At least one line item is required', 400, 'BAD_REQUEST');
    }

    // Look up SponsorUser by tag for defaults
    const sponsorUser = await prisma.sponsorUser.findFirst({
      where: { tag },
    });

    // Auto-generate invoice number: TAG-NNN
    const existingCount = await prisma.invoice.count({
      where: { tag },
    });
    const invoiceNumber = `TAG-${String(existingCount + 1).padStart(3, '0')}`;

    // Generate view token
    const viewToken = crypto.randomBytes(32).toString('hex');

    // Calculate total from line items
    const total = lineItems.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);

    // Determine bill-to (use overrides, fall back to SponsorUser)
    const finalBillToEmail = billToEmail || sponsorUser?.email || '';
    if (!finalBillToEmail) {
      throw new AppError('Bill-to email is required', 400, 'BAD_REQUEST');
    }

    const invoice = await prisma.invoice.create({
      data: {
        tag,
        sponsorUserId: sponsorUser?.id || null,
        invoiceNumber,
        viewToken,
        billToCompany: billToCompany || sponsorUser?.coHostName || null,
        billToContact: billToContact || sponsorUser?.name || null,
        billToAddress: billToAddress || null,
        billToEmail: finalBillToEmail,
        ccEmails: ccEmails || [],
        lineItems,
        total,
        paymentTerms: paymentTerms || 'Due on receipt',
        paymentInstructions: paymentInstructions || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        memo: memo || null,
        status: 'draft',
      },
    });

    res.status(201).json({ invoice });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/tag-invoices
// List all tag-based invoices
// ============================================

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, tag, search } = req.query;

    const where: any = {};

    // Only show tag-based invoices (tag is not null)
    where.tag = { not: null };

    if (status && status !== 'all') {
      where.status = status as string;
    }
    if (tag && tag !== 'all') {
      where.tag = tag as string;
    }
    if (search) {
      const searchStr = search as string;
      where.OR = [
        { invoiceNumber: { contains: searchStr, mode: 'insensitive' as const } },
        { billToCompany: { contains: searchStr, mode: 'insensitive' as const } },
        { tag: { contains: searchStr, mode: 'insensitive' as const } },
      ];
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        sponsorUser: {
          select: {
            id: true,
            coHostName: true,
            tag: true,
          },
        },
      },
    });

    res.json({ invoices });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/tag-invoices/:id
// Get a single tag invoice
// ============================================

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        sponsorUser: {
          select: {
            id: true,
            coHostName: true,
            email: true,
            tag: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    res.json({ invoice });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PATCH /api/tag-invoices/:id
// Update a draft tag invoice
// ============================================

router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'draft') {
      throw new AppError('Only draft invoices can be edited', 400, 'BAD_REQUEST');
    }

    const {
      lineItems,
      paymentTerms,
      paymentInstructions,
      memo,
      dueDate,
      billToCompany,
      billToContact,
      billToEmail,
      billToAddress,
      ccEmails,
    } = req.body;

    const updateData: any = {};

    if (lineItems !== undefined) {
      updateData.lineItems = lineItems;
      updateData.total = lineItems.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);
    }
    if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms;
    if (paymentInstructions !== undefined) updateData.paymentInstructions = paymentInstructions;
    if (memo !== undefined) updateData.memo = memo;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (billToCompany !== undefined) updateData.billToCompany = billToCompany;
    if (billToContact !== undefined) updateData.billToContact = billToContact;
    if (billToEmail !== undefined) updateData.billToEmail = billToEmail;
    if (billToAddress !== undefined) updateData.billToAddress = billToAddress;
    if (ccEmails !== undefined) updateData.ccEmails = ccEmails;

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ invoice });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DELETE /api/tag-invoices/:id
// Delete a draft tag invoice
// ============================================

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'draft') {
      throw new AppError('Only draft invoices can be deleted', 400, 'BAD_REQUEST');
    }

    await prisma.invoice.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/tag-invoices/:id/send
// Mark invoice as issued (send)
// ============================================

router.post('/:id/send', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'draft' && existing.status !== 'issued') {
      throw new AppError('Invoice cannot be sent in current status', 400, 'BAD_REQUEST');
    }

    if (!existing.billToEmail) {
      throw new AppError('Invoice must have a bill-to email', 400, 'BAD_REQUEST');
    }

    const lineItems = existing.lineItems as any[];
    if (!lineItems || lineItems.length === 0) {
      throw new AppError('Invoice must have at least one line item', 400, 'BAD_REQUEST');
    }

    // Update status to issued
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: 'issued',
        sentAt: new Date(),
      },
    });

    // NOTE: PDF generation and email sending via Resend will be integrated
    // once @react-pdf/renderer and resend packages are configured with
    // the proper API keys. For now, the invoice is marked as issued and
    // can be viewed via the public view token URL.

    res.json({ invoice, message: 'Invoice marked as issued' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/tag-invoices/:id/mark-paid
// Mark invoice as paid
// ============================================

router.post('/:id/mark-paid', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (existing.status === 'paid') {
      throw new AppError('Invoice is already paid', 400, 'BAD_REQUEST');
    }

    if (existing.status === 'cancelled') {
      throw new AppError('Cancelled invoices cannot be marked as paid', 400, 'BAD_REQUEST');
    }

    const { paymentMethod, paymentRef, paidAmount } = req.body;

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paidAmount: paidAmount || existing.total,
        paymentMethod: paymentMethod || 'manual',
        paymentRef: paymentRef || null,
      },
    });

    res.json({ invoice });
  } catch (error) {
    next(error);
  }
});

export default router;
