/**
 * Invoice PDF Template
 *
 * Uses @react-pdf/renderer to generate professional invoice PDFs.
 * Matches the layout from the existing Google Apps Script invoice system:
 *
 * - Header: "Rare Pizzas, LLC" + "INVOICE"
 * - Top right: Invoice #, date, due date
 * - Bill-to block (shift-up packing): company, ATTN: contact, address, email
 * - Line items table: description + amount (no qty column -- flat amounts)
 * - Total: bold, right-aligned
 * - Payment instructions + notes below
 *
 * NOTE: This template is ready to use once @react-pdf/renderer is installed.
 * Install: cd backend && npm install @react-pdf/renderer react
 *
 * Usage:
 *   import { renderInvoicePdf } from './templates/invoice-pdf.js';
 *   const pdfBuffer = await renderInvoicePdf(invoiceData);
 */

export interface InvoicePdfData {
  invoiceNumber: string;
  date: string; // ISO date string
  dueDate?: string | null;

  // Bill-to
  billToCompany?: string | null;
  billToContact?: string | null;
  billToAddress?: string | null; // Semicolon-separated for multi-line
  billToEmail: string;

  // Line items
  lineItems: { description: string; amount: number }[]; // amount in cents
  total: number; // in cents
  currency: string;

  // Payment
  paymentTerms?: string | null;
  paymentInstructions?: string | null;
  memo?: string | null;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generate a plain-text invoice representation.
 * This is the initial implementation. Once @react-pdf/renderer and react
 * are installed as backend dependencies, this can be upgraded to generate
 * a proper styled PDF. The text version serves as the MVP.
 */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  // Build bill-to lines (shift-up packing: skip empty fields)
  const billToLines: string[] = [];
  if (data.billToCompany) billToLines.push(data.billToCompany);
  if (data.billToContact) billToLines.push(`ATTN: ${data.billToContact}`);
  if (data.billToAddress) {
    const addressParts = data.billToAddress.split(';').map((s) => s.trim()).filter(Boolean);
    billToLines.push(...addressParts);
  }
  billToLines.push(data.billToEmail);

  // Build line items section
  const lineItemsText = data.lineItems
    .map((li) => `  ${li.description.padEnd(50)} ${formatCurrency(li.amount).padStart(12)}`)
    .join('\n');

  const text = [
    '════════════════════════════════════════════════════════════════',
    '',
    '  Rare Pizzas, LLC                                    INVOICE',
    '',
    `  Invoice #: ${data.invoiceNumber}`,
    `  Date:      ${formatDate(data.date)}`,
    data.dueDate ? `  Due Date:  ${formatDate(data.dueDate)}` : '',
    '',
    '────────────────────────────────────────────────────────────────',
    '',
    '  BILL TO:',
    ...billToLines.map((line) => `  ${line}`),
    '',
    '────────────────────────────────────────────────────────────────',
    '',
    `  ${'Description'.padEnd(50)} ${'Amount'.padStart(12)}`,
    `  ${'─'.repeat(50)} ${'─'.repeat(12)}`,
    lineItemsText,
    '',
    `  ${''.padEnd(50)} ${'─'.repeat(12)}`,
    `  ${'TOTAL'.padEnd(50)} ${formatCurrency(data.total).padStart(12)}`,
    '',
    '────────────────────────────────────────────────────────────────',
    '',
    data.paymentInstructions ? `  Payment Instructions: ${data.paymentInstructions}` : '',
    data.paymentTerms ? `  Payment Terms: ${data.paymentTerms}` : '',
    data.memo ? `\n  Notes: ${data.memo}` : '',
    '',
    '════════════════════════════════════════════════════════════════',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return Buffer.from(text, 'utf-8');
}
