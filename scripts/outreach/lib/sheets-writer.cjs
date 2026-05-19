// scripts/outreach/lib/sheets-writer.cjs
// Minimal Google Sheets helper: OAuth2 (refresh-token flow) + create/write.
//
// Required env vars (loaded by the caller from .env):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Scopes:
//   https://www.googleapis.com/auth/spreadsheets   (read+write existing sheets)
//   https://www.googleapis.com/auth/drive.file     (create new spreadsheets)
//
// Both helpers take/return 2D arrays-of-strings; the caller is responsible for
// pre-stringifying numbers/booleans where it wants specific formatting.

const { google } = require('googleapis');

function buildOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth env vars. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
      'GOOGLE_REFRESH_TOKEN in scripts/outreach/.env (see .env.example for the ' +
      'values from ~/.claude/CLAUDE.md gdrive section).'
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: buildOAuthClient() });
}

/**
 * Create a fresh spreadsheet with the given title and one tab per entry in
 * `tabs`. Each tab entry: { name, rows: string[][] }. Row[0] is treated as a
 * header row (frozen + bolded).
 *
 * Returns { spreadsheetId, url }.
 */
async function createSpreadsheet(title, tabs) {
  const sheets = sheetsClient();

  const resp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: tabs.map((tab, i) => ({
        properties: {
          sheetId: i,
          title: tab.name,
          gridProperties: { frozenRowCount: 1 },
        },
      })),
    },
  });

  const spreadsheetId = resp.data.spreadsheetId;
  const url = resp.data.spreadsheetUrl;

  // Write each tab in turn.
  for (const tab of tabs) {
    if (!tab.rows || tab.rows.length === 0) continue;
    await writeTab(spreadsheetId, tab.name, tab.rows);
  }

  // Bold the header row in every tab.
  const requests = tabs.map((_, i) => ({
    repeatCell: {
      range: { sheetId: i, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return { spreadsheetId, url };
}

/**
 * Overwrite the entire contents of `tabName` in `spreadsheetId` with `rows`.
 * Caller must guarantee the tab already exists (the API errors otherwise).
 */
async function writeTab(spreadsheetId, tabName, rows) {
  const sheets = sheetsClient();
  // Clear first so older rows don't bleed through.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}`,
  });
  if (!rows || rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

/**
 * For --sheet-id mode: ensure each tab in `tabs` exists on the target
 * spreadsheet (creating missing ones), then write its rows.
 */
async function writeExistingSpreadsheet(spreadsheetId, tabs) {
  const sheets = sheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(
    (meta.data.sheets || []).map((s) => s.properties.title)
  );

  const toAdd = tabs
    .filter((t) => !existingTitles.has(t.name))
    .map((t) => ({
      addSheet: {
        properties: {
          title: t.name,
          gridProperties: { frozenRowCount: 1 },
        },
      },
    }));
  if (toAdd.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toAdd },
    });
  }

  for (const tab of tabs) {
    await writeTab(spreadsheetId, tab.name, tab.rows);
  }

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

module.exports = { createSpreadsheet, writeTab, writeExistingSpreadsheet };
