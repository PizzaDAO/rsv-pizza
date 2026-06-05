/**
 * salame-92110: PDF generators for host tax forms (W-9 / W-8BEN / W-8BEN-E).
 *
 * Ported from the standalone tax-form repo (src/pdf-generator.js, pdf-lib
 * based). W-9 + W-8BEN are direct ports; W-8BEN-E is new — copies the W-8BEN
 * structure and adds entity-specific fields (entity name, country of
 * incorporation, chapter 3/4 status, GIIN). Parts II–XXVIII (advanced FATCA
 * classifications) are intentionally skipped; complex cases fall back to a
 * paper form (admin override).
 *
 * Each generator returns a `Buffer` so the caller can hand it straight to the
 * storage service.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

// ---------- helpers ----------

interface FieldOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  value?: string;
  font: PDFFont;
  boldFont?: PDFFont;
  fontSize?: number;
}

function drawField(page: PDFPage, opts: FieldOpts) {
  const { x, y, width, height, label, value, font, boldFont, fontSize = 10 } = opts;
  // Box border
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
  });
  // Label (small, gray)
  if (label) {
    page.drawText(label, {
      x: x + 3,
      y: y - 10,
      size: 7,
      font: boldFont || font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  // Value
  if (value) {
    const valueY = label ? y - height + 6 : y - height + 10;
    page.drawText(String(value), {
      x: x + 4,
      y: valueY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

interface CheckboxOpts {
  x: number;
  y: number;
  checked: boolean;
  label?: string;
  font: PDFFont;
}

function drawCheckbox(page: PDFPage, opts: CheckboxOpts) {
  const { x, y, checked, label, font } = opts;
  page.drawRectangle({
    x,
    y: y - 10,
    width: 10,
    height: 10,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
  });
  if (checked) {
    page.drawText('X', { x: x + 1.5, y: y - 9, size: 9, font, color: rgb(0, 0, 0) });
  }
  if (label) {
    page.drawText(label, { x: x + 14, y: y - 9, size: 8, font, color: rgb(0, 0, 0) });
  }
}

/** Wrap a long string to fit `maxWidth` at `size` using the given font. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

// ---------- W-9 ----------

export interface W9FormData {
  name: string;
  businessName?: string;
  taxClassification:
    | 'individual'
    | 'c_corp'
    | 's_corp'
    | 'partnership'
    | 'trust_estate'
    | 'llc_c'
    | 'llc_s'
    | 'llc_p'
    | 'other';
  exemptPayeeCode?: string;
  fatcaCode?: string;
  address: string;
  cityStateZip: string;
  accountNumbers?: string;
  ssn?: string;
  ein?: string;
  signature: string;
  date: string;
}

export async function generateW9PDF(data: W9FormData, refId: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;

  // Header
  page.drawRectangle({ x: 0, y: 740, width: W, height: 52, color: rgb(0.15, 0.15, 0.15) });
  page.drawText('Form W-9', { x: 30, y: 762, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Request for Taxpayer Identification Number and Certification', {
    x: 30,
    y: 748,
    size: 9,
    font,
    color: rgb(0.85, 0.85, 0.85),
  });
  page.drawText('Department of the Treasury — Internal Revenue Service', {
    x: 340,
    y: 762,
    size: 8,
    font,
    color: rgb(0.85, 0.85, 0.85),
  });
  page.drawText('Rev. October 2018', {
    x: 340,
    y: 748,
    size: 8,
    font,
    color: rgb(0.7, 0.7, 0.7),
  });

  let y = 730;

  // Line 1 - Name
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '1  Name (as shown on your income tax return). Name is required; do not leave blank.',
    value: data.name,
    font,
    boldFont: bold,
  });
  y -= 40;

  // Line 2 - Business name
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '2  Business name/disregarded entity name, if different from above',
    value: data.businessName || '',
    font,
    boldFont: bold,
  });
  y -= 40;

  // Line 3 - Tax classification
  page.drawText(
    '3  Check appropriate box for federal tax classification of the person whose name is entered on line 1:',
    { x: 33, y: y - 2, size: 7, font: bold, color: rgb(0.3, 0.3, 0.3) },
  );
  y -= 16;

  const classifications: Array<{
    key: W9FormData['taxClassification'];
    label: string;
  }> = [
    { key: 'individual', label: 'Individual/Sole prop.' },
    { key: 'c_corp', label: 'C Corp' },
    { key: 's_corp', label: 'S Corp' },
    { key: 'partnership', label: 'Partnership' },
    { key: 'trust_estate', label: 'Trust/Estate' },
    { key: 'llc_c', label: 'LLC' },
    { key: 'other', label: 'Other' },
  ];
  let cx = 33;
  for (const cls of classifications) {
    const checked =
      data.taxClassification === cls.key
      || (cls.key === 'llc_c' && ['llc_c', 'llc_s', 'llc_p'].includes(data.taxClassification));
    drawCheckbox(page, { x: cx, y, checked, label: cls.label, font });
    cx += font.widthOfTextAtSize(cls.label, 8) + 28;
  }
  y -= 18;

  // Line 4 - Exemptions
  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '4  Exempt payee code (if any)',
    value: data.exemptPayeeCode || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '    FATCA reporting code (if any)',
    value: data.fatcaCode || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  // Line 5 - Address
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '5  Address (number, street, and apt. or suite no.)',
    value: data.address,
    font,
    boldFont: bold,
  });
  y -= 40;

  // Line 6 - City, state, ZIP
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '6  City, state, and ZIP code',
    value: data.cityStateZip,
    font,
    boldFont: bold,
  });
  y -= 40;

  // Line 7 - Account numbers
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '7  List account number(s) here (optional)',
    value: data.accountNumbers || '',
    font,
    boldFont: bold,
  });
  y -= 50;

  // Part I - TIN
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: rgb(0.15, 0.15, 0.15) });
  y -= 6;
  page.drawText('Part I', { x: 33, y: y - 4, size: 10, font: bold, color: rgb(0.15, 0.15, 0.15) });
  page.drawText('Taxpayer Identification Number (TIN)', {
    x: 80,
    y: y - 4,
    size: 10,
    font,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 18;

  page.drawText(
    'Enter your TIN in the appropriate box. For individuals, this is generally your social security number (SSN).',
    { x: 33, y: y - 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) },
  );
  y -= 14;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 36,
    label: 'Social security number (SSN)',
    value: data.ssn || '',
    font,
    boldFont: bold,
    fontSize: 13,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 36,
    label: 'Employer identification number (EIN)',
    value: data.ein || '',
    font,
    boldFont: bold,
    fontSize: 13,
  });
  y -= 50;

  // Part II - Certification
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: rgb(0.15, 0.15, 0.15) });
  y -= 6;
  page.drawText('Part II', { x: 33, y: y - 4, size: 10, font: bold, color: rgb(0.15, 0.15, 0.15) });
  page.drawText('Certification', {
    x: 80,
    y: y - 4,
    size: 10,
    font,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 18;

  const certText =
    'Under penalties of perjury, I certify that: (1) The number shown on this form is my correct taxpayer identification number, (2) I am not subject to backup withholding, (3) I am a U.S. citizen or other U.S. person, and (4) The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.';
  for (const line of wrapText(certText, font, 7.5, 540)) {
    page.drawText(line, { x: 33, y: y - 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 10;
  }
  y -= 10;

  // Signature line
  page.drawRectangle({ x: 30, y: y - 1, width: 552, height: 1, color: rgb(0, 0, 0) });
  y -= 4;
  drawField(page, {
    x: 30,
    y,
    width: 380,
    height: 32,
    label: 'Signature of U.S. person',
    value: data.signature,
    font,
    boldFont: bold,
    fontSize: 13,
  });
  drawField(page, {
    x: 410,
    y,
    width: 172,
    height: 32,
    label: 'Date',
    value: data.date,
    font,
    boldFont: bold,
  });

  // Footer
  page.drawText(`Generated ${todayIso()}  |  Submission #${refId}`, {
    x: 30,
    y: 30,
    size: 7,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ---------- W-8BEN ----------

export interface W8BENFormData {
  name: string;
  citizenship: string;
  permanentAddress: string;
  permanentCity: string;
  permanentCountry: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingCountry?: string;
  usTin?: string;
  foreignTin?: string;
  referenceNumbers?: string;
  dateOfBirth: string;
  treatyCountry?: string;
  articleParagraph?: string;
  withholdingRate?: string;
  incomeType?: string;
  treatyExplanation?: string;
  signature: string;
  date: string;
}

export async function generateW8BENPDF(data: W8BENFormData, refId: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const HEADER = rgb(0.05, 0.25, 0.45);

  // Header
  page.drawRectangle({ x: 0, y: 740, width: W, height: 52, color: HEADER });
  page.drawText('Form W-8BEN', { x: 30, y: 762, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Certificate of Foreign Status of Beneficial Owner', {
    x: 30,
    y: 748,
    size: 8,
    font,
    color: rgb(0.8, 0.85, 0.95),
  });
  page.drawText('Department of the Treasury — Internal Revenue Service', {
    x: 340,
    y: 762,
    size: 8,
    font,
    color: rgb(0.8, 0.85, 0.95),
  });
  page.drawText('Rev. October 2021', {
    x: 340,
    y: 748,
    size: 8,
    font,
    color: rgb(0.6, 0.7, 0.8),
  });

  let y = 725;

  // Part I header
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page.drawText('Part I', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page.drawText('Identification of Beneficial Owner', {
    x: 80,
    y: y - 4,
    size: 10,
    font,
    color: HEADER,
  });
  y -= 20;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '1  Name of individual who is the beneficial owner',
    value: data.name,
    font,
    boldFont: bold,
  });
  y -= 40;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '2  Country of citizenship',
    value: data.citizenship,
    font,
    boldFont: bold,
  });
  y -= 40;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '3  Permanent residence address (street, apt. or suite no., or rural route)',
    value: data.permanentAddress,
    font,
    boldFont: bold,
  });
  y -= 40;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '    City or town',
    value: data.permanentCity,
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '    Country',
    value: data.permanentCountry,
    font,
    boldFont: bold,
  });
  y -= 36;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '4  Mailing address (if different from above)',
    value: data.mailingAddress || '',
    font,
    boldFont: bold,
  });
  y -= 40;

  if (data.mailingCity || data.mailingCountry) {
    drawField(page, {
      x: 30,
      y,
      width: 276,
      height: 32,
      label: '    City or town',
      value: data.mailingCity || '',
      font,
      boldFont: bold,
    });
    drawField(page, {
      x: 306,
      y,
      width: 276,
      height: 32,
      label: '    Country',
      value: data.mailingCountry || '',
      font,
      boldFont: bold,
    });
    y -= 36;
  }

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '5  U.S. taxpayer identification number (SSN or ITIN)',
    value: data.usTin || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '6  Foreign tax identifying number (FTIN)',
    value: data.foreignTin || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '7  Reference number(s)',
    value: data.referenceNumbers || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '8  Date of birth (MM-DD-YYYY)',
    value: data.dateOfBirth,
    font,
    boldFont: bold,
  });
  y -= 44;

  // Part II - Treaty Benefits
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page.drawText('Part II', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page.drawText('Claim of Tax Treaty Benefits (for chapter 3 purposes only)', {
    x: 80,
    y: y - 4,
    size: 10,
    font,
    color: HEADER,
  });
  y -= 20;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 32,
    label: '9  I certify that the beneficial owner is a resident of:',
    value: data.treatyCountry || 'N/A',
    font,
    boldFont: bold,
  });
  y -= 36;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '10  Article and paragraph',
    value: data.articleParagraph || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 136,
    height: 32,
    label: '    Withholding rate (%)',
    value: data.withholdingRate || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 442,
    y,
    width: 140,
    height: 32,
    label: '    Type of income',
    value: data.incomeType || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  if (data.treatyExplanation) {
    drawField(page, {
      x: 30,
      y,
      width: 552,
      height: 40,
      label: '    Explanation',
      value: data.treatyExplanation,
      font,
      boldFont: bold,
      fontSize: 8,
    });
    y -= 44;
  }

  y -= 8;

  // Part III - Certification
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page.drawText('Part III', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page.drawText('Certification', { x: 85, y: y - 4, size: 10, font, color: HEADER });
  y -= 18;

  const certText =
    'Under penalties of perjury, I declare that I have examined the information on this form and to the best of my knowledge and belief it is true, correct, and complete. I further certify under penalties of perjury that I am the individual that is the beneficial owner (or am authorized to sign for the individual that is the beneficial owner) of all the income to which this form relates, that I am not a U.S. person, and that I am a resident of the treaty country listed above (if any).';
  for (const line of wrapText(certText, font, 7.5, 540)) {
    page.drawText(line, { x: 33, y: y - 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 10;
  }
  y -= 10;

  page.drawRectangle({ x: 30, y: y - 1, width: 552, height: 1, color: rgb(0, 0, 0) });
  y -= 4;
  drawField(page, {
    x: 30,
    y,
    width: 380,
    height: 32,
    label: 'Sign here — Signature of beneficial owner (or individual authorized to sign)',
    value: data.signature,
    font,
    boldFont: bold,
    fontSize: 13,
  });
  drawField(page, {
    x: 410,
    y,
    width: 172,
    height: 32,
    label: 'Date (MM-DD-YYYY)',
    value: data.date,
    font,
    boldFont: bold,
  });

  page.drawText(`Generated ${todayIso()}  |  Submission #${refId}`, {
    x: 30,
    y: 30,
    size: 7,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ---------- W-8BEN-E ----------

export type W8BENEEntityType =
  | 'corporation'
  | 'partnership'
  | 'simple_trust'
  | 'grantor_trust'
  | 'complex_trust'
  | 'estate'
  | 'government'
  | 'central_bank'
  | 'tax_exempt_org'
  | 'private_foundation'
  | 'international_org';

export type W8BENEChapter4Status = 'active_nffe' | 'passive_nffe' | 'ffi';

export interface W8BENEFormData {
  // Part I — Identification
  entityName: string;
  countryOfIncorporation: string;
  disregardedEntityName?: string;
  entityType: W8BENEEntityType;
  chapter4Status: W8BENEChapter4Status;
  permanentAddress: string;
  permanentCity: string;
  permanentCountry: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingCountry?: string;
  usTin?: string;
  giin?: string;
  foreignTin?: string;
  referenceNumbers?: string;
  // Part III — Claim of Tax Treaty Benefits (chapter 3). Same field names as
  // W-8BEN Part II so the frontend (mortadella-92107) reuses the auto-suggest.
  treatyCountry?: string;
  articleParagraph?: string;
  withholdingRate?: string;
  incomeType?: string;
  treatyExplanation?: string;
  // Part XXIX — Certification
  signature: string;
  signerCapacity?: string;
  date: string;
}

export async function generateW8BENEPDF(data: W8BENEFormData, refId: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  // Slightly darker blue than W-8BEN so the two foreign forms are visually
  // distinguishable at a glance in the admin reviewer.
  const HEADER = rgb(0.04, 0.18, 0.36);

  page.drawRectangle({ x: 0, y: 740, width: W, height: 52, color: HEADER });
  page.drawText('Form W-8BEN-E', { x: 30, y: 762, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Certificate of Status of Beneficial Owner for U.S. Tax Withholding (Entities)', {
    x: 30,
    y: 748,
    size: 8,
    font,
    color: rgb(0.8, 0.85, 0.95),
  });
  page.drawText('Department of the Treasury — Internal Revenue Service', {
    x: 340,
    y: 762,
    size: 8,
    font,
    color: rgb(0.8, 0.85, 0.95),
  });
  page.drawText('Rev. October 2021', {
    x: 340,
    y: 748,
    size: 8,
    font,
    color: rgb(0.6, 0.7, 0.8),
  });

  let y = 725;

  // Part I header
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page.drawText('Part I', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page.drawText('Identification of Beneficial Owner', {
    x: 80,
    y: y - 4,
    size: 10,
    font,
    color: HEADER,
  });
  y -= 20;

  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '1  Name of organization that is the beneficial owner',
    value: data.entityName,
    font,
    boldFont: bold,
  });
  y -= 40;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 36,
    label: '2  Country of incorporation or organization',
    value: data.countryOfIncorporation,
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 36,
    label: '3  Name of disregarded entity (if any)',
    value: data.disregardedEntityName || '',
    font,
    boldFont: bold,
  });
  y -= 40;

  // Line 4 - Entity (chapter 3) status — render as a vertical-ish list of
  // checkboxes inside a labeled box. Keep it scannable for an admin reviewer.
  page.drawText('4  Chapter 3 Status (entity type)', {
    x: 33,
    y: y - 2,
    size: 7,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 14;

  const entityTypes: Array<{ key: W8BENEEntityType; label: string }> = [
    { key: 'corporation', label: 'Corporation' },
    { key: 'partnership', label: 'Partnership' },
    { key: 'simple_trust', label: 'Simple trust' },
    { key: 'grantor_trust', label: 'Grantor trust' },
    { key: 'complex_trust', label: 'Complex trust' },
    { key: 'estate', label: 'Estate' },
    { key: 'government', label: 'Government' },
    { key: 'central_bank', label: 'Central bank of issue' },
    { key: 'tax_exempt_org', label: 'Tax-exempt organization' },
    { key: 'private_foundation', label: 'Private foundation' },
    { key: 'international_org', label: 'International organization' },
  ];
  // Two columns of checkboxes
  const colWidth = 270;
  let col = 0;
  let rowYCursor = y;
  for (const et of entityTypes) {
    const cx = 33 + col * colWidth;
    drawCheckbox(page, { x: cx, y: rowYCursor, checked: data.entityType === et.key, label: et.label, font });
    if (col === 0) {
      col = 1;
    } else {
      col = 0;
      rowYCursor -= 14;
    }
  }
  // Account for final row if odd-count list left col=1 unfilled
  if (col === 1) rowYCursor -= 14;
  y = rowYCursor - 6;

  // Line 5 - Chapter 4 (FATCA) status — simplified to the 3 buckets we
  // actually support; FFI surfaces a "contact admin" warning on the UI.
  page.drawText('5  Chapter 4 Status (FATCA status)', {
    x: 33,
    y: y - 2,
    size: 7,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 14;

  const ch4: Array<{ key: W8BENEChapter4Status; label: string }> = [
    { key: 'active_nffe', label: 'Active NFFE' },
    { key: 'passive_nffe', label: 'Passive NFFE' },
    { key: 'ffi', label: 'FFI (contact admin — paper form required)' },
  ];
  let ch4cx = 33;
  for (const c of ch4) {
    drawCheckbox(page, { x: ch4cx, y, checked: data.chapter4Status === c.key, label: c.label, font });
    ch4cx += font.widthOfTextAtSize(c.label, 8) + 28;
  }
  y -= 18;

  // Line 6 - Permanent address
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '6  Permanent residence address (street, apt. or suite no., or rural route)',
    value: data.permanentAddress,
    font,
    boldFont: bold,
  });
  y -= 40;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '    City or town',
    value: data.permanentCity,
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '    Country',
    value: data.permanentCountry,
    font,
    boldFont: bold,
  });
  y -= 36;

  // Line 7 - Mailing address
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 36,
    label: '7  Mailing address (if different from above)',
    value: data.mailingAddress || '',
    font,
    boldFont: bold,
  });
  y -= 40;

  if (data.mailingCity || data.mailingCountry) {
    drawField(page, {
      x: 30,
      y,
      width: 276,
      height: 32,
      label: '    City or town',
      value: data.mailingCity || '',
      font,
      boldFont: bold,
    });
    drawField(page, {
      x: 306,
      y,
      width: 276,
      height: 32,
      label: '    Country',
      value: data.mailingCountry || '',
      font,
      boldFont: bold,
    });
    y -= 36;
  }

  // Line 8 - U.S. TIN (optional for entities)
  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '8  U.S. taxpayer identification number (EIN) — if any',
    value: data.usTin || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '9  GIIN (if applicable)',
    value: data.giin || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '9b  Foreign TIN',
    value: data.foreignTin || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 276,
    height: 32,
    label: '10  Reference number(s)',
    value: data.referenceNumbers || '',
    font,
    boldFont: bold,
  });
  y -= 44;

  // Part III — Claim of Tax Treaty Benefits (chapter 3 only). Mirrors the
  // W-8BEN Part II rendering pattern. Renders even when fields are blank so
  // the admin reviewer can see the section was intentionally not claimed.
  // Parts II + IV–XXVIII (advanced FATCA classifications) are still skipped;
  // those cases fall back to a paper form.
  page.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page.drawText('Part III', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page.drawText('Claim of Tax Treaty Benefits (for chapter 3 purposes only)', {
    x: 85,
    y: y - 4,
    size: 10,
    font,
    color: HEADER,
  });
  y -= 20;

  // 14a — Resident-of-treaty-country statement.
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 32,
    label:
      '14a  I certify that the beneficial owner is a resident of the following country within the meaning of the income tax treaty between the United States and that country:',
    value: data.treatyCountry || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  // 14b — Derives-income checkbox. Checked when a treaty country was named
  // (the host is affirmatively claiming the benefit). When blank, we leave
  // the box unchecked.
  drawCheckbox(page, {
    x: 33,
    y,
    checked: Boolean(data.treatyCountry && data.treatyCountry.trim()),
    font,
  });
  const derivesText =
    '14b  The beneficial owner derives the item (or items) of income for which the treaty benefits are claimed, and, if applicable, meets the requirements of the treaty provision dealing with limitation on benefits.';
  let derivesY = y;
  for (const line of wrapText(derivesText, font, 7.5, 520)) {
    page.drawText(line, { x: 50, y: derivesY - 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    derivesY -= 10;
  }
  y = derivesY - 6;

  // 15 — Article / paragraph + withholding rate + income type (one row).
  drawField(page, {
    x: 30,
    y,
    width: 276,
    height: 32,
    label: '15  Article and paragraph of treaty',
    value: data.articleParagraph || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 306,
    y,
    width: 136,
    height: 32,
    label: '    Withholding rate (%)',
    value: data.withholdingRate || '',
    font,
    boldFont: bold,
  });
  drawField(page, {
    x: 442,
    y,
    width: 140,
    height: 32,
    label: '    Type of income',
    value: data.incomeType || '',
    font,
    boldFont: bold,
  });
  y -= 36;

  // Explanation of additional conditions — optional, but always render the
  // box so the form looks consistent.
  drawField(page, {
    x: 30,
    y,
    width: 552,
    height: 40,
    label:
      '    Explain the additional conditions in the Article and paragraph the beneficial owner meets to be eligible for the rate of withholding:',
    value: data.treatyExplanation || '',
    font,
    boldFont: bold,
    fontSize: 8,
  });
  y -= 48;

  // Part I + Part III fill page 1; push certification onto page 2 so the
  // signature box never collides with the footer.
  const page2 = doc.addPage([612, 792]);
  y = 760;

  // Part XXIX - Certification (we skip the intermediate FATCA-classification
  // parts II + IV–XXVIII; complex cases use a paper form).
  page2.drawRectangle({ x: 30, y: y - 2, width: 552, height: 2, color: HEADER });
  y -= 6;
  page2.drawText('Part XXIX', { x: 33, y: y - 4, size: 10, font: bold, color: HEADER });
  page2.drawText('Certification', { x: 95, y: y - 4, size: 10, font, color: HEADER });
  y -= 18;

  const certText =
    'Under penalties of perjury, I declare that I have examined the information on this form and to the best of my knowledge and belief it is true, correct, and complete. I further certify under penalties of perjury that the entity identified on line 1 of this form is the beneficial owner of all the income to which this form relates, is using this form to certify its status for chapter 4 purposes, and is not a U.S. person. I agree that I will submit a new form within 30 days if any certification on this form becomes incorrect.';
  for (const line of wrapText(certText, font, 7.5, 540)) {
    page2.drawText(line, { x: 33, y: y - 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 10;
  }
  y -= 10;

  page2.drawRectangle({ x: 30, y: y - 1, width: 552, height: 1, color: rgb(0, 0, 0) });
  y -= 4;
  drawField(page2, {
    x: 30,
    y,
    width: 280,
    height: 32,
    label: 'Sign here — Signature of person authorized to sign for the beneficial owner',
    value: data.signature,
    font,
    boldFont: bold,
    fontSize: 13,
  });
  drawField(page2, {
    x: 310,
    y,
    width: 130,
    height: 32,
    label: 'Capacity (e.g. Director)',
    value: data.signerCapacity || '',
    font,
    boldFont: bold,
  });
  drawField(page2, {
    x: 440,
    y,
    width: 142,
    height: 32,
    label: 'Date (MM-DD-YYYY)',
    value: data.date,
    font,
    boldFont: bold,
  });

  // Footer on both pages so the submission id is visible regardless of which
  // page an admin downloads/prints in isolation.
  page.drawText(`Generated ${todayIso()}  |  Submission #${refId}  |  Page 1 of 2`, {
    x: 30,
    y: 30,
    size: 7,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });
  page2.drawText(`Generated ${todayIso()}  |  Submission #${refId}  |  Page 2 of 2`, {
    x: 30,
    y: 30,
    size: 7,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
