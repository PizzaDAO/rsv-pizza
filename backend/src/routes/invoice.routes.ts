import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import { generateInvoicePdf } from '../lib/invoicePdf.js';
import { WIRE_DETAILS_PDF_B64 } from '../assets/wireDetailsPdf.js';
import { W9_PDF_B64 } from '../assets/w9Pdf.js';

/**
 * Compute the calendar year for the given date in the specified timezone.
 * Falls back to the UTC year if timezone is null/undefined/invalid.
 */
function getEventYear(date: Date | null | undefined, timezone: string | null | undefined): number {
  const now = new Date();
  const effective = date ?? now;
  if (timezone) {
    try {
      const year = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(effective);
      const parsed = parseInt(year, 10);
      if (!isNaN(parsed)) return parsed;
    } catch {
      // fall through to UTC
    }
  }
  return effective.getUTCFullYear();
}

/**
 * Atomically allocate the next invoice number for the given (scope, year).
 * Returns a formatted invoice number string like "GPP-2026-00001" or "2026-00001".
 */
async function allocateInvoiceNumber(
  isGpp: boolean,
  year: number,
): Promise<string> {
  const scope = isGpp ? 'gpp' : 'nongpp';
  const rows = await prisma.$queryRaw<Array<{ next_val: number }>>`
    INSERT INTO invoice_counters (scope, year, next_val)
    VALUES (${scope}, ${year}, 1)
    ON CONFLICT (scope, year)
    DO UPDATE SET next_val = invoice_counters.next_val + 1
    RETURNING next_val
  `;
  const nextVal = rows[0].next_val;
  const padded = String(nextVal).padStart(5, '0');
  return isGpp ? `GPP-${year}-${padded}` : `${year}-${padded}`;
}

// ============================================
// Host routes (mounted at /api/parties)
// ============================================
const hostRouter = Router();

// GET /api/parties/:partyId/invoices - List all invoices for a party
hostRouter.get('/:partyId/invoices', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    const invoices = await prisma.invoice.findMany({
      where: { partyId },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ invoices });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/invoices/:invoiceId - Get single invoice
hostRouter.get('/:partyId/invoices/:invoiceId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, invoiceId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, partyId },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
        party: {
          select: { name: true },
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

// POST /api/parties/:partyId/invoices - Create invoice for a sponsor
hostRouter.post('/:partyId/invoices', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      sponsorId,
      billToCompany,
      billToContact,
      billToAddress,
      billToEmail,
      ccEmails,
      lineItems,
      total,
      currency,
      paymentTerms,
      paymentInstructions,
      dueDate,
      memo,
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

    // Load party metadata needed for invoice numbering
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { eventType: true, date: true, timezone: true },
    });

    // Compute scope (gpp vs nongpp) and calendar year of the event
    const isGpp = party?.eventType === 'gpp';
    const eventYear = getEventYear(party?.date, party?.timezone);

    // Atomically allocate a globally-unique, per-year invoice number
    const invoiceNumber = await allocateInvoiceNumber(isGpp, eventYear);

    // Generate view token
    const viewToken = crypto.randomBytes(32).toString('hex');

    // Use sponsor data as defaults for bill-to fields
    const finalBillToEmail = billToEmail || sponsor.contactEmail;
    if (!finalBillToEmail) {
      throw new AppError('Bill-to email is required (sponsor has no contact email)', 400, 'VALIDATION_ERROR');
    }

    // Pre-populate line items from sponsor amount if no line items provided
    let finalLineItems = lineItems || [];
    let finalTotal = total || 0;

    if (finalLineItems.length === 0 && sponsor.amount) {
      const amountInCents = Math.round(Number(sponsor.amount) * 100);
      finalLineItems = [{
        description: sponsor.sponsorshipType
          ? `${sponsor.sponsorshipType.charAt(0).toUpperCase() + sponsor.sponsorshipType.slice(1)} Sponsorship`
          : 'Sponsorship',
        amount: amountInCents,
      }];
      finalTotal = amountInCents;
    }

    const invoice = await prisma.invoice.create({
      data: {
        partyId,
        sponsorId,
        invoiceNumber,
        viewToken,
        billToCompany: billToCompany || sponsor.name || null,
        billToContact: billToContact || sponsor.contactName || null,
        billToAddress: billToAddress || null,
        billToEmail: finalBillToEmail,
        ccEmails: ccEmails || [],
        lineItems: finalLineItems,
        total: finalTotal,
        currency: currency || 'usd',
        paymentTerms: paymentTerms || null,
        paymentInstructions: paymentInstructions || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        memo: memo || null,
        attachments: attachments || [],
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    res.status(201).json({ invoice });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/invoices/:invoiceId - Update invoice
hostRouter.patch('/:partyId/invoices/:invoiceId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, invoiceId } = req.params;
    const {
      billToCompany,
      billToContact,
      billToAddress,
      billToEmail,
      ccEmails,
      lineItems,
      total,
      currency,
      paymentTerms,
      paymentInstructions,
      dueDate,
      memo,
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

    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, partyId },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(billToCompany !== undefined && { billToCompany: billToCompany || null }),
        ...(billToContact !== undefined && { billToContact: billToContact || null }),
        ...(billToAddress !== undefined && { billToAddress: billToAddress || null }),
        ...(billToEmail !== undefined && { billToEmail }),
        ...(ccEmails !== undefined && { ccEmails }),
        ...(lineItems !== undefined && { lineItems }),
        ...(total !== undefined && { total }),
        ...(currency !== undefined && { currency }),
        ...(paymentTerms !== undefined && { paymentTerms: paymentTerms || null }),
        ...(paymentInstructions !== undefined && { paymentInstructions: paymentInstructions || null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(memo !== undefined && { memo: memo || null }),
        ...(attachments !== undefined && { attachments }),
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    res.json({ invoice });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/invoices/:invoiceId - Delete draft invoice
hostRouter.delete('/:partyId/invoices/:invoiceId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, invoiceId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, partyId },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'draft') {
      throw new AppError('Only draft invoices can be deleted', 400, 'VALIDATION_ERROR');
    }

    await prisma.invoice.delete({
      where: { id: invoiceId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/invoices/:invoiceId/send - Send invoice email
hostRouter.post('/:partyId/invoices/:invoiceId/send', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, invoiceId } = req.params;
    const { resend: forceResend } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, partyId },
      include: {
        party: { select: { name: true } },
        sponsor: { select: { id: true, name: true } },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    // Validate
    const lineItems = invoice.lineItems as Array<{ description: string; amount: number }>;
    if (!lineItems || lineItems.length === 0) {
      throw new AppError('Invoice must have at least one line item', 400, 'VALIDATION_ERROR');
    }

    if (!invoice.billToEmail) {
      throw new AppError('Invoice must have a bill-to email', 400, 'VALIDATION_ERROR');
    }

    // Prevent re-send unless explicitly forced
    if (invoice.status === 'issued' && !forceResend) {
      throw new AppError('Invoice already sent. Pass { resend: true } to re-send.', 400, 'ALREADY_SENT');
    }

    // Build invoice view URL
    const invoiceViewUrl = `https://rsv.pizza/invoice/${invoice.viewToken}`;

    // Format amounts for email
    const formatAmount = (cents: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (invoice.currency || 'usd').toUpperCase(),
        minimumFractionDigits: 2,
      }).format(cents / 100);
    };

    // Build line items HTML
    const lineItemsHtml = lineItems.map(item => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; color: #333;">${item.description}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; text-align: right; color: #333; white-space: nowrap;">${formatAmount(item.amount)}</td>
      </tr>
    `).join('');

    const dueDateText = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    // Format invoice total for the short note
    const totalDisplay = (invoice.total / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

    // Build email HTML — short personal note; full invoice is the PDF attachment
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invoice #${invoice.invoiceNumber}</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f9f9f9; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
            <p style="margin: 0 0 16px 0; font-size: 16px;">Thanks for helping us pizza the planet! See invoice attached.</p>
            <p style="margin: 0 0 16px 0; font-size: 16px;"><strong>TL;DR ${totalDisplay} USDC to dreadpizzaroberts.eth</strong></p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${invoiceViewUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Pay this invoice online</a>
            </div>
            <p style="margin: 0; font-size: 15px;">See our Wire Details (if preferred) + our W9 attached.</p>
          </div>
          <p style="font-size: 15px; color: #333;">Best,<br>Dread Pizza Roberts</p>
        </body>
      </html>
    `;

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      const emailPayload: any = {
        from: 'RSV.Pizza <noreply@rsv.pizza>',
        to: [invoice.billToEmail],
        subject: `Invoice #${invoice.invoiceNumber} - ${invoice.billToCompany || invoice.sponsor.name} - ${invoice.party.name}`,
        html: emailHtml,
      };

      // Add CC recipients
      if (invoice.ccEmails && invoice.ccEmails.length > 0) {
        emailPayload.cc = invoice.ccEmails;
      }

      // Always attach Wire Details + W9; prepend invoice PDF if generation succeeds
      emailPayload.attachments = [
        { filename: 'Rare Pizzas LLC - Wire Details.pdf', content: WIRE_DETAILS_PDF_B64 },
        { filename: 'Rare Pizzas LLC - W9.pdf', content: W9_PDF_B64 },
      ];
      try {
        const pdfBuffer = await generateInvoicePdf(invoice);
        emailPayload.attachments.unshift({
          filename: `Invoice-${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer.toString('base64'),
        });
      } catch (err) {
        console.error('[invoice] PDF generation failed, sending without invoice attachment:', err);
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

    // Update invoice status
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'issued',
        sentAt: new Date(),
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    // Auto-update sponsor status to 'billed'
    await prisma.sponsor.update({
      where: { id: invoice.sponsorId },
      data: { status: 'billed' },
    });

    res.json({ invoice: updatedInvoice, emailSent: !!resendApiKey });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/invoices/:invoiceId/mark-paid - Mark invoice as paid
hostRouter.post('/:partyId/invoices/:invoiceId/mark-paid', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, invoiceId } = req.params;
    const { paymentMethod, paymentRef, paidAmount } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccess) {
      throw new AppError('You do not have access to the partners tab', 403, 'TAB_ACCESS_DENIED');
    }

    const existing = await prisma.invoice.findFirst({
      where: { id: invoiceId, partyId },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    const validMethods = ['usdc', 'wire', 'stripe', 'check', 'manual'];
    if (paymentMethod && !validMethods.includes(paymentMethod)) {
      throw new AppError(`Invalid payment method. Must be one of: ${validMethods.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paidAmount: paidAmount ?? existing.total,
        paymentMethod: paymentMethod || 'manual',
        paymentRef: paymentRef || null,
      },
      include: {
        sponsor: {
          select: { id: true, name: true, contactEmail: true, logoUrl: true },
        },
      },
    });

    // Auto-update sponsor status to 'paid'
    await prisma.sponsor.update({
      where: { id: existing.sponsorId },
      data: { status: 'paid' },
    });

    res.json({ invoice });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Public routes (mounted at /api/invoice)
// ============================================
const publicRouter = Router();

// GET /api/invoice/:viewToken - Public invoice view
publicRouter.get('/:viewToken', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
      include: {
        party: { select: { name: true, eventImageUrl: true } },
        sponsor: { select: { name: true, logoUrl: true } },
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

// GET /api/invoice/:viewToken/pdf - Download invoice as printable HTML
publicRouter.get('/:viewToken/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
      include: {
        party: { select: { name: true } },
        sponsor: { select: { name: true } },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    const pdfBuffer = await generateInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// POST /api/invoice/:viewToken/record-view - Record first view timestamp
publicRouter.post('/:viewToken/record-view', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    // Only record first view
    if (!invoice.viewedAt) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          viewedAt: new Date(),
          status: invoice.status === 'issued' ? 'viewed' : invoice.status,
        },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/invoice/:viewToken/pay - Record payment (public, token-gated)
publicRouter.post('/:viewToken/pay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.params;
    const { paymentMethod, paymentRef, paidAmount, chainId, tokenSymbol } = req.body;

    if (!paymentMethod || !paymentRef) {
      throw new AppError('paymentMethod and paymentRef are required', 400, 'VALIDATION_ERROR');
    }

    const validMethods = ['stripe', 'usdc', 'crypto'];
    if (!validMethods.includes(paymentMethod)) {
      throw new AppError(`Invalid payment method. Must be one of: ${validMethods.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
      include: {
        sponsor: { select: { id: true } },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }

    // Only allow payment on issued or viewed invoices
    if (!['issued', 'viewed'].includes(invoice.status)) {
      throw new AppError(
        invoice.status === 'paid'
          ? 'This invoice has already been paid'
          : `Cannot pay an invoice with status "${invoice.status}"`,
        400,
        'INVALID_STATUS'
      );
    }

    // Build payment ref with chain/token info for crypto payments
    let fullPaymentRef = paymentRef;
    if (chainId || tokenSymbol) {
      const parts = [paymentRef];
      if (chainId) parts.push(`chain:${chainId}`);
      if (tokenSymbol) parts.push(`token:${tokenSymbol}`);
      fullPaymentRef = parts.join(' | ');
    }

    // Update invoice to paid
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paidAmount: paidAmount ?? invoice.total,
        paymentMethod,
        paymentRef: fullPaymentRef,
      },
      include: {
        party: { select: { name: true, eventImageUrl: true } },
        sponsor: { select: { name: true, logoUrl: true } },
      },
    });

    // Auto-update sponsor status to 'paid'
    await prisma.sponsor.update({
      where: { id: invoice.sponsorId },
      data: { status: 'paid' },
    });

    res.json({ invoice: updatedInvoice });
  } catch (error) {
    next(error);
  }
});

export { hostRouter as invoiceHostRoutes, publicRouter as invoicePublicRoutes };
