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

    // Auto-generate invoice number (count existing + 1, zero-padded to 3 digits)
    const existingCount = await prisma.invoice.count({
      where: { partyId },
    });
    const invoiceNumber = String(existingCount + 1).padStart(3, '0');

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

    // Build email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invoice #${invoice.invoiceNumber}</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ffffff; font-size: 28px; margin: 0 0 10px 0;">Invoice #${invoice.invoiceNumber}</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">${invoice.party.name}</p>
          </div>

          <div style="background: #f9f9f9; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
            <p style="margin: 0 0 16px 0; font-size: 16px;">
              Thanks for helping us pizza the planet!
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
              <thead>
                <tr style="background: #1a1a2e;">
                  <th style="padding: 12px 16px; text-align: left; color: #ffffff; font-size: 14px; border-radius: 6px 0 0 0;">Description</th>
                  <th style="padding: 12px 16px; text-align: right; color: #ffffff; font-size: 14px; border-radius: 0 6px 0 0;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${lineItemsHtml}
              </tbody>
              <tfoot>
                <tr>
                  <td style="padding: 12px 16px; font-weight: bold; font-size: 16px; color: #1a1a2e;">Total</td>
                  <td style="padding: 12px 16px; text-align: right; font-weight: bold; font-size: 16px; color: #1a1a2e;">${formatAmount(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>

            ${invoice.paymentInstructions ? `
              <div style="background: #fff; padding: 16px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 12px;">
                <p style="margin: 0 0 4px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px;">Payment Instructions</p>
                <p style="margin: 0; font-size: 14px; color: #333; white-space: pre-wrap;">${invoice.paymentInstructions}</p>
              </div>
            ` : ''}

            ${invoice.paymentTerms ? `
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
                <strong>Terms:</strong> ${invoice.paymentTerms}
              </p>
            ` : ''}

            ${dueDateText ? `
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">
                <strong>Due:</strong> ${dueDateText}
              </p>
            ` : ''}

            ${invoice.memo ? `
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #666;">
                <strong>Note:</strong> ${invoice.memo}
              </p>
            ` : ''}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${invoiceViewUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Invoice Online</a>
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
        to: [invoice.billToEmail],
        subject: `Invoice #${invoice.invoiceNumber} - ${invoice.billToCompany || invoice.sponsor.name} - ${invoice.party.name}`,
        html: emailHtml,
      };

      // Add CC recipients
      if (invoice.ccEmails && invoice.ccEmails.length > 0) {
        emailPayload.cc = invoice.ccEmails;
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

    const formatAmount = (cents: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (invoice.currency || 'usd').toUpperCase(),
        minimumFractionDigits: 2,
      }).format(cents / 100);
    };

    const lineItems = invoice.lineItems as Array<{ description: string; amount: number }>;
    const lineItemsHtml = lineItems.map(item => `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #eee;">${item.description}</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${formatAmount(item.amount)}</td>
      </tr>
    `).join('');

    const invoiceDate = invoice.sentAt
      ? new Date(invoice.sentAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date(invoice.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const dueDateText = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    // Address lines from semicolon-separated string
    const addressLines = invoice.billToAddress
      ? invoice.billToAddress.split(';').map(line => line.trim()).filter(Boolean)
      : [];

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Invoice #${invoice.invoiceNumber} - ${invoice.billToCompany || ''}</title>
          <style>
            @media print {
              body { margin: 0; padding: 20px; }
              .no-print { display: none !important; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px;
              line-height: 1.5;
            }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
            .header-left h1 { margin: 0; font-size: 28px; color: #1a1a2e; }
            .header-left p { margin: 4px 0 0; color: #666; font-size: 14px; }
            .header-right { text-align: right; font-size: 14px; color: #666; }
            .header-right strong { color: #333; display: block; }
            .bill-to { margin-bottom: 32px; }
            .bill-to h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
            .bill-to p { margin: 2px 0; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
            thead th { padding: 10px 0; border-bottom: 2px solid #1a1a2e; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
            thead th:last-child { text-align: right; }
            .total-row td { padding: 12px 0; font-weight: bold; font-size: 18px; border-top: 2px solid #1a1a2e; }
            .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 14px; color: #666; }
            .footer p { margin: 6px 0; }
            .footer strong { color: #333; }
            .print-btn {
              position: fixed; bottom: 20px; right: 20px;
              background: #1a1a2e; color: white; border: none;
              padding: 12px 24px; border-radius: 8px; cursor: pointer;
              font-size: 14px; font-weight: 600;
            }
            .print-btn:hover { background: #16213e; }
          </style>
        </head>
        <body>
          <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

          <div class="header">
            <div class="header-left">
              <h1>INVOICE</h1>
              <p>${invoice.party.name}</p>
            </div>
            <div class="header-right">
              <strong>Invoice #${invoice.invoiceNumber}</strong>
              <span>Date: ${invoiceDate}</span><br>
              ${dueDateText ? `<span>Due: ${dueDateText}</span><br>` : ''}
            </div>
          </div>

          <div class="bill-to">
            <h3>Bill To</h3>
            ${invoice.billToCompany ? `<p><strong>${invoice.billToCompany}</strong></p>` : ''}
            ${invoice.billToContact ? `<p>ATTN: ${invoice.billToContact}</p>` : ''}
            ${addressLines.map(line => `<p>${line}</p>`).join('')}
            <p>${invoice.billToEmail}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemsHtml}
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td>Total</td>
                <td style="text-align: right;">${formatAmount(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>

          <div class="footer">
            ${invoice.paymentInstructions ? `
              <p><strong>Payment Instructions:</strong></p>
              <p style="white-space: pre-wrap;">${invoice.paymentInstructions}</p>
            ` : ''}
            ${invoice.paymentTerms ? `<p><strong>Terms:</strong> ${invoice.paymentTerms}</p>` : ''}
            ${invoice.memo ? `<p><strong>Note:</strong> ${invoice.memo}</p>` : ''}
          </div>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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
