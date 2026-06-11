import { PDFDocument, StandardFonts, rgb, PageSizes, PDFString, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { PIZZADAO_LOGO_SVG } from '../assets/pizzadaoLogoSvg.js';

// ── Issuer constants ──────────────────────────────────────────────────────────
const ISSUER = {
  name: 'Rare Pizzas, LLC',
  addressLines: ['30 N Gould St.', 'Sheridan, WY 82801'],
  phone: '1 (267) 603-7264',
  cryptoEns: 'dreadpizzaroberts.eth',
  cryptoAddress: '0xF41a98D4F2E52aa1ccB48F0b6539e955707b8F7a',
};

// ── Logo cache (render once, reuse) ───────────────────────────────────────────
let _logoPng: Buffer | null = null;
async function getLogoPng(): Promise<Buffer> {
  if (_logoPng) return _logoPng;
  const blackSvg = PIZZADAO_LOGO_SVG.replace(/fill="white"/g, 'fill="black"');
  _logoPng = await sharp(Buffer.from(blackSvg)).resize({ width: 760 }).png().toBuffer();
  return _logoPng;
}

/**
 * Format cents as a currency string (e.g. 150000 → "$1,500.00").
 */
function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Format a date value as M/D/YYYY.
 */
function formatDate(val: string | number | Date | null | undefined): string {
  if (!val) return 'Upon Receipt';
  const d = new Date(val as any);
  if (isNaN(d.getTime())) return 'Upon Receipt';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/**
 * Wrap text into lines that fit within maxWidth using the given font+size.
 */
function wrapText(
  text: string,
  maxWidth: number,
  font: any,
  fontSize: number,
): string[] {
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
 * Generate a PDF invoice matching the PizzaDAO invoice template design.
 * Returns a Buffer containing the PDF bytes.
 */
export async function generateInvoicePdf(invoice: any): Promise<Buffer> {
  const doc = await PDFDocument.create();

  // ── Fonts (monospace = typewriter look) ─────────────────────────────────────
  const fontRegular = await doc.embedFont(StandardFonts.Courier);
  const fontBold    = await doc.embedFont(StandardFonts.CourierBold);
  const fontFallback = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Colours ──────────────────────────────────────────────────────────────────
  const orange     = rgb(0.93, 0.415, 0.10);   // #ED6A1A
  const greyColor  = rgb(0.53, 0.53,  0.53);
  const lightGrey  = rgb(0.82, 0.82,  0.82);
  const black      = rgb(0,    0,     0);
  const white      = rgb(1,    1,     1);

  // ── Page setup ───────────────────────────────────────────────────────────────
  const [pageW, pageH] = PageSizes.Letter; // 612 × 792
  const margin    = 50;
  const contentW  = pageW - margin * 2;   // 512
  const page      = doc.addPage([pageW, pageH]);

  // ── Data extraction ───────────────────────────────────────────────────────────
  const currency  = invoice.currency || 'usd';
  const fmt       = (cents: number) => formatAmount(cents, currency);
  const lineItems: Array<{ description: string; amount: number }> =
    Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  const appUrl  = process.env.FRONTEND_URL || process.env.APP_URL || 'https://rsv.pizza';
  const payUrl  = `${appUrl}/invoice/${invoice.viewToken}`;

  const issueDate  = formatDate(invoice.sentAt ?? invoice.createdAt ?? Date.now());
  const dueDate    = invoice.dueDate ? formatDate(invoice.dueDate) : 'Upon Receipt';
  const invoiceNum = invoice.invoiceNumber ?? '';

  const company  = invoice.billToCompany || invoice.sponsor?.name || '';
  const contact  = invoice.billToContact || '';
  const email    = invoice.billToEmail   || '';

  // ── Helpers ───────────────────────────────────────────────────────────────────
  /** Draw text with y measured from the TOP of the page. */
  function dt(
    text: string,
    x: number,
    yTop: number,
    opts: { font?: any; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) {
    const f    = opts.font  ?? fontRegular;
    const sz   = opts.size  ?? 10;
    const col  = opts.color ?? black;
    page.drawText(text, { x, y: pageH - yTop, font: f, size: sz, color: col });
  }

  function line(x1: number, y1: number, x2: number, y2: number, color = lightGrey, thickness = 0.5) {
    page.drawLine({
      start: { x: x1, y: pageH - y1 },
      end:   { x: x2, y: pageH - y2 },
      thickness, color,
    });
  }

  function rect(x: number, yTop: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: pageH - yTop - h, width: w, height: h, color });
  }

  // ── 1. TOP ORANGE BAR ─────────────────────────────────────────────────────────
  rect(margin, 30, contentW, 7, orange);

  let y = 30; // cursor from top

  // ── 2. HEADER ROW: logo (left) + pay button (right) ──────────────────────────
  y += 7 + 12; // 12pt gap below bar

  // Logo
  const logoTargetW = 190;
  const logoAspect  = 490 / 80;
  const logoH       = logoTargetW / logoAspect; // ≈31pt

  let logoDrawn = false;
  try {
    const logoPngBuf = await getLogoPng();
    // Sanity-check: mean brightness < 250 means it has dark content
    const stats = await sharp(logoPngBuf).stats();
    const mean = stats.channels.reduce((s, c) => s + c.mean, 0) / stats.channels.length;
    if (mean < 250) {
      const logoImg = await doc.embedPng(logoPngBuf);
      page.drawImage(logoImg, { x: margin, y: pageH - y - logoH, width: logoTargetW, height: logoH });
      logoDrawn = true;
    }
  } catch (_) {
    // fall through to text fallback
  }
  if (!logoDrawn) {
    dt('PizzaDAO', margin, y + logoH * 0.6, { font: fontFallback, size: 22, color: black });
  }

  // Pay Invoice Online button (right side)
  const btnW = 170, btnH = 34;
  const btnX = pageW - margin - btnW;
  const btnY = y - 2; // align top with header row

  // Orange filled rectangle for the button
  page.drawRectangle({
    x: btnX, y: pageH - btnY - btnH,
    width: btnW, height: btnH,
    color: orange,
  });

  const btnLabel = 'Pay Invoice Online';
  const btnLabelSz = 10;
  const btnLabelW = fontBold.widthOfTextAtSize(btnLabel, btnLabelSz);
  page.drawText(btnLabel, {
    x: btnX + (btnW - btnLabelW) / 2,
    y: pageH - btnY - btnH / 2 - btnLabelSz * 0.38,
    font: fontBold,
    size: btnLabelSz,
    color: white,
  });

  // Link annotation on button
  try {
    const annot = doc.context.obj({
      Type:    PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect:    doc.context.obj([btnX, pageH - btnY - btnH, btnX + btnW, pageH - btnY]),
      Border:  doc.context.obj([0, 0, 0]),
      A: doc.context.obj({
        Type: PDFName.of('Action'),
        S:    PDFName.of('URI'),
        URI:  PDFString.of(payUrl),
      }),
    });
    const ref = doc.context.register(annot);
    const ex  = page.node.Annots();
    if (ex) ex.push(ref);
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  } catch (_) {
    // Annotation unavailable — button is still visible
  }

  y += Math.max(logoH, btnH) + 30;

  // ── 3. TWO-COLUMN INFO ROW ───────────────────────────────────────────────────
  // LEFT col: issuer address + crypto
  // RIGHT col: invoice metadata + bill-to (form-style underlines)

  const colMid = margin + contentW * 0.45; // split point
  const rightColX = colMid + 10;
  const rightValX = rightColX + 120;

  // LEFT: Mailing Address
  dt('Mailing Address', margin, y, { font: fontBold, size: 9, color: black });
  y += 14;
  dt(ISSUER.name, margin, y, { size: 9 });
  y += 12;
  for (const addrLine of ISSUER.addressLines) {
    dt(addrLine, margin, y, { size: 9 });
    y += 12;
  }
  dt(ISSUER.phone, margin, y, { size: 9 });
  const yAfterAddr = y + 12;

  // LEFT: Crypto address block (starts at yAfterAddr + gap)
  const cryptoY = yAfterAddr + 8;
  dt('Address (Mainnet or L2)', margin, cryptoY, { font: fontBold, size: 9, color: black });
  const ensText = ISSUER.cryptoEns;
  dt(ensText, margin, cryptoY + 13, { font: fontBold, size: 9, color: orange });
  dt('full address:', margin, cryptoY + 25, { size: 8, color: greyColor });
  dt(ISSUER.cryptoAddress, margin, cryptoY + 36, { size: 7, color: black });

  // RIGHT: Invoice metadata
  let ry = y - 14 * 4 - 12; // align with first row of left col (Mailing Address label)

  const labelSz = 9;
  const valSz   = 9;

  function drawMetaRow(label: string, value: string, rowY: number) {
    dt(label, rightColX, rowY, { font: fontBold, size: labelSz, color: greyColor });
    dt(value, rightValX, rowY, { size: valSz, color: black });
  }

  drawMetaRow('Invoice Number:', invoiceNum, ry);
  ry += 14;
  drawMetaRow('Issue Date:', issueDate, ry);
  ry += 14;
  drawMetaRow('Due Date:', dueDate, ry);
  ry += 20;

  // Bill To
  dt('Bill to:', rightColX, ry, { font: fontBold, size: labelSz, color: black });
  ry += 14;

  const billToRows: string[] = [];
  if (company) billToRows.push(company);
  if (contact) billToRows.push(`ATTN: ${contact}`);
  if (email)   billToRows.push(email);

  for (const row of billToRows) {
    dt(row, rightColX, ry, { size: valSz, color: black });
    ry += 14;
    // thin grey underline beneath each bill-to line (form style)
    line(rightColX, ry - 2, pageW - margin, ry - 2, greyColor, 0.4);
  }

  // Advance y past the two-column block
  y = Math.max(cryptoY + 36 + 14, ry) + 16;

  // ── 4. DETAILS TABLE ─────────────────────────────────────────────────────────
  const tableLeft  = margin;
  const tableRight = margin + contentW;
  const amtColW    = 100; // right column width
  const descColX   = tableLeft + 8;
  const amtColX    = tableRight - amtColW; // left edge of amount column
  const tableHeaderH = 20;

  // Grey header row
  rect(tableLeft, y, contentW, tableHeaderH, rgb(0.85, 0.85, 0.85));
  // Vertical divider between desc and amount in header
  line(amtColX, y, amtColX, y + tableHeaderH, greyColor, 0.5);

  dt('Details', descColX, y + 13, { font: fontBold, size: 9, color: black });
  const amtHdr = 'Amount';
  const amtHdrW = fontBold.widthOfTextAtSize(amtHdr, 9);
  dt(amtHdr, tableRight - amtHdrW - 8, y + 13, { font: fontBold, size: 9, color: black });

  y += tableHeaderH;

  // Table border (will be drawn as lines after rows)
  const tableTopY = y - tableHeaderH;

  // Row height
  const rowH = 20;

  for (const item of lineItems) {
    const descLines = wrapText(item.description, amtColX - descColX - 8, fontRegular, 9);
    const thisRowH  = Math.max(rowH, descLines.length * 12 + 8);

    // Outer border lines
    line(tableLeft, y, tableRight, y, greyColor, 0.4);

    // Vertical divider in row
    line(amtColX, y, amtColX, y + thisRowH, greyColor, 0.5);

    // Description (wrapped)
    for (let li = 0; li < descLines.length; li++) {
      dt(descLines[li], descColX, y + 12 + li * 12, { size: 9 });
    }

    // Amount (right-aligned)
    const amtStr = fmt(item.amount);
    const amtW   = fontRegular.widthOfTextAtSize(amtStr, 9);
    dt(amtStr, tableRight - amtW - 8, y + 12, { size: 9 });

    y += thisRowH;
  }

  // Bottom border of last data row
  line(tableLeft, y, tableRight, y, greyColor, 0.4);

  // Subtotal row
  const subtotalH = 20;
  line(amtColX, y, amtColX, y + subtotalH, greyColor, 0.5);
  const subtotalStr = fmt(invoice.total ?? 0);
  const subtotalW   = fontBold.widthOfTextAtSize(subtotalStr, 10);
  dt('Subtotal', descColX, y + 13, { font: fontBold, size: 9, color: black });
  dt(subtotalStr, tableRight - subtotalW - 8, y + 13, { font: fontBold, size: 10, color: black });
  y += subtotalH;

  // Right border + left border of table
  line(tableLeft,  tableTopY, tableLeft,  y, greyColor, 0.4);
  line(tableRight, tableTopY, tableRight, y, greyColor, 0.4);

  y += 18;

  // ── 5. AMOUNT DUE ─────────────────────────────────────────────────────────────
  dt('Amount Due', margin, y, { font: fontBold, size: 16, color: orange });

  const amtDueStr = fmt(invoice.total ?? 0);
  const amtDueSz  = 16;
  const amtDueW   = fontBold.widthOfTextAtSize(amtDueStr, amtDueSz);
  const amtDueX   = pageW - margin - amtDueW;
  dt(amtDueStr, amtDueX, y, { font: fontBold, size: amtDueSz, color: black });

  // Thick black underline under the amount
  y += 4;
  line(amtDueX, y, pageW - margin, y, black, 2);

  y += 22;

  // ── 6. NOTES ──────────────────────────────────────────────────────────────────
  dt('Notes:', margin, y, { size: 8, color: greyColor });
  y += 13;

  const notesBoxH = 60;
  page.drawRectangle({
    x: margin,
    y: pageH - y - notesBoxH,
    width: contentW,
    height: notesBoxH,
    borderColor: greyColor,
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
  });

  if (invoice.memo) {
    const memoLines = wrapText(invoice.memo, contentW - 16, fontRegular, 8);
    for (let mi = 0; mi < memoLines.length && mi < 4; mi++) {
      dt(memoLines[mi], margin + 8, y + 12 + mi * 12, { size: 8, color: black });
    }
  }

  y += notesBoxH + 20;

  // ── 7. FOOTER ─────────────────────────────────────────────────────────────────
  // Centered thanks text
  const thanksText = 'Thanks for helping us pizza the planet!';
  const thanksSz   = 9;
  const thanksW    = fontBold.widthOfTextAtSize(thanksText, thanksSz);
  const footerTextY = 52; // 52pt from bottom (native pdf-lib y is from bottom)
  page.drawText(thanksText, {
    x: (pageW - thanksW) / 2,
    y: footerTextY,
    font: fontBold,
    size: thanksSz,
    color: black,
  });

  // Bottom orange bar
  page.drawRectangle({ x: margin, y: 30, width: contentW, height: 7, color: orange });

  // ── Serialize ─────────────────────────────────────────────────────────────────
  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
