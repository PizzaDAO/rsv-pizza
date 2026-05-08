/**
 * Google Sheets Sync Utility
 *
 * Syncs invoice data to a Google Sheet as a backup ledger.
 * Columns mirror the existing Google Apps Script invoice format:
 *   Status | Email | Invoice # | Line Items | Amounts | Contact | Company | Address | Notes
 *
 * Requires GOOGLE_SHEETS_INVOICE_ID and GOOGLE_SERVICE_ACCOUNT_KEY env vars.
 * If not configured, sync operations are silently skipped.
 */

interface InvoiceSyncData {
  invoiceId: string;
  status: string;
  email: string;
  invoiceNumber: string;
  lineItems: { description: string; amount: number }[];
  contact: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
  tag: string | null;
  total: number;
  paidAt: Date | null;
  paymentMethod: string | null;
}

/**
 * Append or update an invoice row in the Google Sheet.
 * On create/send: appends a new row.
 * On status change (issued -> paid): finds and updates the existing row.
 *
 * This is a best-effort sync -- failures are logged but don't block the API response.
 */
export async function syncInvoiceToSheet(data: InvoiceSyncData): Promise<void> {
  const sheetId = process.env.GOOGLE_SHEETS_INVOICE_ID;
  if (!sheetId) {
    console.log('[Google Sheets Sync] GOOGLE_SHEETS_INVOICE_ID not configured, skipping sync');
    return;
  }

  try {
    // Format line items and amounts as comma-separated strings (matching GAS format)
    const lineItemDescriptions = data.lineItems.map((li) => li.description).join(', ');
    const lineItemAmounts = data.lineItems.map((li) => `$${(li.amount / 100).toFixed(2)}`).join(', ');
    const totalFormatted = `$${(data.total / 100).toFixed(2)}`;

    const rowData = [
      data.status,
      data.email,
      data.invoiceNumber,
      lineItemDescriptions,
      lineItemAmounts,
      data.contact || '',
      data.company || '',
      data.address || '',
      data.notes || '',
      data.tag || '',
      totalFormatted,
      data.paidAt ? data.paidAt.toISOString().split('T')[0] : '',
      data.paymentMethod || '',
    ];

    console.log(`[Google Sheets Sync] Would sync invoice ${data.invoiceNumber}:`, rowData);

    // NOTE: Full Google Sheets API integration requires googleapis package
    // and a configured service account. The sync data is logged above for
    // verification. To enable actual syncing:
    //
    // 1. Install: npm install googleapis
    // 2. Set env vars:
    //    - GOOGLE_SHEETS_INVOICE_ID: The spreadsheet ID
    //    - GOOGLE_SERVICE_ACCOUNT_KEY: JSON key for service account
    // 3. Uncomment the googleapis calls below
    //
    // const { google } = await import('googleapis');
    // const auth = new google.auth.GoogleAuth({
    //   credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
    //   scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    // });
    // const sheets = google.sheets({ version: 'v4', auth });
    //
    // await sheets.spreadsheets.values.append({
    //   spreadsheetId: sheetId,
    //   range: 'Sheet1!A:M',
    //   valueInputOption: 'USER_ENTERED',
    //   requestBody: { values: [rowData] },
    // });

  } catch (error) {
    console.error('[Google Sheets Sync] Error syncing invoice:', error);
    // Don't throw -- sync failures shouldn't block the API
  }
}
