import { PDFDocument, StandardFonts, rgb, PageSizes, PDFString, PDFName } from 'pdf-lib';
import { PIZZADAO_LOGO_JPG_BASE64 } from '../assets/pizzadaoLogo.js';

/**
 * Format cents as a currency string (e.g. 150000 → "$1,500.00").
 * Matches the formatAmount helper in invoice.routes.ts.
 */
function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Wrap text into lines that fit within maxWidth using the given font+size.
 * Returns an array of strings.
 */
async function wrapText(
  text: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontSize: number,
): Promise<string[]> {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generate a PDF invoice using pdf-lib (pure JS, no Chromium/Puppeteer).
 * Returns a Buffer containing the PDF bytes.
 */
export async function generateInvoicePdf(invoice: any): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Colours ──────────────────────────────────────────────────────────────
  const navy = rgb(0.102, 0.102, 0.180);   // #1a1a2e
  const red  = rgb(1.0,  0.224, 0.227);    // #ff393a
  const grey = rgb(0.4,  0.4,   0.4);
  const lightGrey = rgb(0.88, 0.88, 0.88);
  const black = rgb(0,   0,     0);
  const white = rgb(1,   1,     1);

  // ── Page setup ───────────────────────────────────────────────────────────
  // Letter: 612 × 792 pt
  const [pageW, pageH] = PageSizes.Letter;
  const margin = 50;
  const contentW = pageW - margin * 2;

  // ── Helpers ──────────────────────────────────────────────────────────────
  let page = doc.addPage([pageW, pageH]);

  /** Draw text at (x, y) from TOP of page (pdf-lib origin is bottom-left). */
  function drawText(
    text: string,
    x: number,
    yFromTop: number,
    opts: {
      font?: typeof fontRegular;
      size?: number;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
    } = {},
  ) {
    const font = opts.font ?? fontRegular;
    const size = opts.size ?? 10;
    const color = opts.color ?? black;
    page.drawText(text, { x, y: pageH - yFromTop, font, size, color });
  }

  function drawLine(x1: number, y1FromTop: number, x2: number, y2FromTop: number, color = lightGrey, thickness = 0.5) {
    page.drawLine({
      start: { x: x1, y: pageH - y1FromTop },
      end:   { x: x2, y: pageH - y2FromTop },
      thickness,
      color,
    });
  }

  function drawRect(x: number, yFromTop: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: pageH - yFromTop - h, width: w, height: h, color });
  }

  // ── Currency & data ───────────────────────────────────────────────────────
  const currency = invoice.currency || 'usd';
  const fmt = (cents: number) => formatAmount(cents, currency);
  const lineItems: Array<{ description: string; amount: number }> =
    Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  // Dates
  const issueDate = (invoice.sentAt ? new Date(invoice.sentAt) : new Date(invoice.createdAt ?? Date.now()))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const dueDateText = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // App URL for footer
  const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://rsv.pizza';
  const payUrl = `${appUrl}/invoice/${invoice.viewToken}`;

  // ── Layout: track cursor position (yFromTop) ──────────────────────────────
  let y = margin; // y from top of page

  // ── HEADER BAND ───────────────────────────────────────────────────────────
  const headerH = 70;
  drawRect(0, 0, pageW, headerH, navy);

  // Logo (try/catch — skip on failure, still produce the PDF)
  try {
    const logoImg = await doc.embedJpg(Buffer.from(PIZZADAO_LOGO_JPG_BASE64, 'base64'));
    // Center vertically in the 70pt band: band top=0, band bottom=70 (from top)
    // Logo is 36×36, so top of logo = (70-36)/2 = 17 from top of band = yFromTop=17
    page.drawImage(logoImg, { x: margin, y: pageH - 53, width: 36, height: 36 });
  } catch (_) {
    // Logo embed failed — continue without it
  }

  // "INVOICE" title — shifted right of the logo (x ≈ margin + 48)
  const titleX = margin + 48;
  page.drawText('INVOICE', {
    x: titleX,
    y: pageH - margin - 14,
    font: fontBold,
    size: 22,
    color: white,
  });

  // Invoice number below title
  const invoiceNumLabel = `#${invoice.invoiceNumber ?? ''}`;
  page.drawText(invoiceNumLabel, {
    x: titleX,
    y: pageH - margin - 32,
    font: fontRegular,
    size: 11,
    color: rgb(0.8, 0.8, 0.8),
  });

  // Party name (right-aligned in header)
  const partyName = invoice.party?.name ?? '';
  if (partyName) {
    const partyW = fontRegular.widthOfTextAtSize(partyName, 10);
    page.drawText(partyName, {
      x: pageW - margin - partyW,
      y: pageH - margin - 14,
      font: fontRegular,
      size: 10,
      color: rgb(0.8, 0.8, 0.8),
    });
  }

  // Issue date + due date (right side of header)
  const dateLabel = `Date: ${issueDate}`;
  const dateLabelW = fontRegular.widthOfTextAtSize(dateLabel, 9);
  page.drawText(dateLabel, {
    x: pageW - margin - dateLabelW,
    y: pageH - margin - 30,
    font: fontRegular,
    size: 9,
    color: rgb(0.7, 0.7, 0.7),
  });

  if (dueDateText) {
    const dueLabel = `Due: ${dueDateText}`;
    const dueLabelW = fontRegular.widthOfTextAtSize(dueLabel, 9);
    page.drawText(dueLabel, {
      x: pageW - margin - dueLabelW,
      y: pageH - margin - 43,
      font: fontRegular,
      size: 9,
      color: rgb(0.7, 0.7, 0.7),
    });
  }

  y = headerH + 24; // cursor after header

  // ── BILL TO ───────────────────────────────────────────────────────────────
  drawText('BILL TO', margin, y, { font: fontBold, size: 8, color: grey });
  y += 14;

  const billToLines: string[] = [];
  const company = invoice.billToCompany || invoice.sponsor?.name || '';
  if (company) billToLines.push(company);
  if (invoice.billToContact) billToLines.push(`ATTN: ${invoice.billToContact}`);
  if (invoice.billToEmail) billToLines.push(invoice.billToEmail);
  if (invoice.billToAddress) {
    const addrLines = invoice.billToAddress.split(';').map((l: string) => l.trim()).filter(Boolean);
    billToLines.push(...addrLines);
  }

  for (let i = 0; i < billToLines.length; i++) {
    const isFirst = i === 0;
    drawText(billToLines[i], margin, y, {
      font: isFirst ? fontBold : fontRegular,
      size: isFirst ? 11 : 10,
      color: black,
    });
    y += isFirst ? 16 : 14;
  }

  y += 18;

  // ── LINE ITEMS TABLE ───────────────────────────────────────────────────────
  const colDescX = margin;
  const colAmtX = margin + contentW; // right edge
  const tableRowH = 20;

  // Table header row
  drawRect(margin, y, contentW, 22, navy);
  page.drawText('Description', { x: colDescX + 8, y: pageH - y - 15, font: fontBold, size: 9, color: white });
  const amtHead = 'Amount';
  const amtHeadW = fontBold.widthOfTextAtSize(amtHead, 9);
  page.drawText(amtHead, { x: colAmtX - amtHeadW - 8, y: pageH - y - 15, font: fontBold, size: 9, color: white });
  y += 22;

  // Line item rows
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    const isEven = i % 2 === 0;

    // Wrap long descriptions
    const descLines = await wrapText(item.description, contentW - 100, fontRegular, 10);
    const rowH = Math.max(tableRowH, descLines.length * 14 + 8);

    if (isEven) {
      drawRect(margin, y, contentW, rowH, rgb(0.97, 0.97, 0.97));
    }

    // Description
    for (let li = 0; li < descLines.length; li++) {
      page.drawText(descLines[li], {
        x: colDescX + 8,
        y: pageH - y - 14 - li * 14,
        font: fontRegular,
        size: 10,
        color: black,
      });
    }

    // Amount (right-aligned)
    const amtStr = fmt(item.amount);
    const amtW = fontRegular.widthOfTextAtSize(amtStr, 10);
    page.drawText(amtStr, {
      x: colAmtX - amtW - 8,
      y: pageH - y - 14,
      font: fontRegular,
      size: 10,
      color: black,
    });

    y += rowH;
    drawLine(margin, y, margin + contentW, y, lightGrey, 0.3);
  }

  // Total row
  drawRect(margin, y, contentW, 26, navy);
  page.drawText('Total', { x: colDescX + 8, y: pageH - y - 17, font: fontBold, size: 11, color: white });
  const totalStr = fmt(invoice.total ?? 0);
  const totalW = fontBold.widthOfTextAtSize(totalStr, 11);
  page.drawText(totalStr, {
    x: colAmtX - totalW - 8,
    y: pageH - y - 17,
    font: fontBold,
    size: 11,
    color: white,
  });
  y += 30;

  // ── PAYMENT INFO ──────────────────────────────────────────────────────────
  if (invoice.paymentInstructions || invoice.paymentTerms || invoice.memo) {
    y += 10;
    drawLine(margin, y, margin + contentW, y, lightGrey);
    y += 14;

    if (invoice.paymentInstructions) {
      drawText('Payment Instructions', margin, y, { font: fontBold, size: 9, color: grey });
      y += 13;
      // Wrap long payment instructions
      const instrLines = invoice.paymentInstructions.split('\n');
      for (const rawLine of instrLines) {
        const wrapped = await wrapText(rawLine || ' ', contentW, fontRegular, 9);
        for (const wl of wrapped) {
          drawText(wl, margin, y, { size: 9, color: black });
          y += 13;
        }
      }
      y += 4;
    }

    if (invoice.paymentTerms) {
      drawText(`Terms: ${invoice.paymentTerms}`, margin, y, { size: 9, color: grey });
      y += 13;
    }

    if (invoice.memo) {
      drawText(`Note: ${invoice.memo}`, margin, y, { size: 9, color: grey });
      y += 13;
    }
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  // All footer coordinates are yFromTop = distance from TOP of page.
  // The footer sits near the BOTTOM: pageH - 66 from top = 66pt from top = 726pt from bottom.
  // Separator line just above the footer text
  drawLine(margin, pageH - 66, margin + contentW, pageH - 66, lightGrey, 0.5);

  // "Pay this invoice online →" in red at bottom-left (yFromTop = pageH - 50 = near bottom)
  const linkText = 'Pay this invoice online >';
  const linkTextSize = 9;
  drawText(linkText, margin, pageH - 50, { font: fontRegular, size: linkTextSize, color: red });

  // Attempt to add a clickable hyperlink annotation for the pay URL
  try {
    const linkW = fontRegular.widthOfTextAtSize(linkText, linkTextSize);
    // PDF coord from bottom: baseline at y=50, so rect spans y=48 to y=60
    const yBottom = 48;
    const yTop = 60;
    const annotDict = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: doc.context.obj([margin, yBottom, margin + linkW, yTop]),
      Border: doc.context.obj([0, 0, 0]),
      A: doc.context.obj({
        Type: PDFName.of('Action'),
        S: PDFName.of('URI'),
        URI: PDFString.of(payUrl),
      }),
    });
    const annotRef = doc.context.register(annotDict);
    const existing = page.node.Annots();
    if (existing) {
      existing.push(annotRef);
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]));
    }
  } catch (_) {
    // Annotation failed — the red text link is still visible in the PDF
  }

  // "Sent via RSV.Pizza" right-aligned
  const sentLabel = 'Sent via RSV.Pizza';
  const sentW = fontRegular.widthOfTextAtSize(sentLabel, 8);
  drawText(sentLabel, pageW - margin - sentW, pageH - 50, { font: fontRegular, size: 8, color: grey });

  // ── Serialize ─────────────────────────────────────────────────────────────
  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
