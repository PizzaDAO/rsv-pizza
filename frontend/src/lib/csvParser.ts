/**
 * Minimal CSV parser for the bulk-invite Promo widget.
 *
 * - Handles quoted fields with embedded commas and escaped quotes (`""`)
 * - Handles CRLF or LF line endings
 * - Trims whitespace on each cell
 * - Detects a header row when a cell matches `name` or `email` variants
 *   (case-insensitive); otherwise assumes column 0 = name, column 1 = email
 * - Falls back to the email local-part for `name` when a row has no name
 *
 * The parser is lenient — it returns every data row, valid or not. The UI
 * component handles validation (invalid email, duplicate, etc.).
 */

export interface ParsedCsvRow {
  name: string;
  email: string;
  /** The raw line from the CSV, for display in debug/error UI. */
  _raw: string;
}

// Split a single CSV line into cells, respecting quoted fields.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote (`""`) -> literal `"`
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);

  return cells.map((c) => c.trim());
}

const NAME_HEADERS = new Set(['name', 'full name', 'full_name', 'fullname']);
const EMAIL_HEADERS = new Set(['email', 'e-mail', 'e_mail', 'email address', 'email_address']);

function isNameHeader(cell: string): boolean {
  return NAME_HEADERS.has(cell.trim().toLowerCase());
}
function isEmailHeader(cell: string): boolean {
  return EMAIL_HEADERS.has(cell.trim().toLowerCase());
}

export function parseCsv(text: string): ParsedCsvRow[] {
  // Strip a BOM if present
  const cleaned = text.replace(/^\uFEFF/, '');

  // Normalize line endings and split
  const lines = cleaned
    .split(/\r\n|\n|\r/)
    .map((l) => l)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  // Detect header row: does the first line have a name header AND an email header?
  const firstCells = splitCsvLine(lines[0]);
  const hasNameHeader = firstCells.some(isNameHeader);
  const hasEmailHeader = firstCells.some(isEmailHeader);
  const headerDetected = hasNameHeader && hasEmailHeader;

  let nameIdx = 0;
  let emailIdx = 1;
  let dataStart = 0;

  if (headerDetected) {
    nameIdx = firstCells.findIndex(isNameHeader);
    emailIdx = firstCells.findIndex(isEmailHeader);
    dataStart = 1;
  }

  const rows: ParsedCsvRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitCsvLine(raw);

    const email = (cells[emailIdx] || '').trim();
    let name = (cells[nameIdx] || '').trim();

    // Fallback: if we don't have a name, use the local part of the email
    if (!name && email.includes('@')) {
      name = email.split('@')[0];
    }

    rows.push({ name, email, _raw: raw });
  }

  return rows;
}
