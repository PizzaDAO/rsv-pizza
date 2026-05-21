/**
 * Platform-specific row parsers for the bulk guest-list import flow.
 *
 * Each parser converts raw `{ headers, rows }` from `parseCsvWithHeaders`
 * into `ParsedRow[]` — a normalized representation with a name, optional
 * email, and a derived `status` / `approved` pair that mirrors how the
 * backend stores `Guest.status` + `Guest.approved`.
 *
 * The frontend preview UI lets the host pick a landing status that
 * overrides whatever the per-row parser computed (Approved / Pending /
 * Checked-in). The per-row mapping is still useful for the preview badge
 * ("waitlisted", "pending") and to skip declined / no-show rows.
 */

import {
  Platform,
  HEADER_PROFILES,
  detectPlatform,
  getProfile,
  GENERIC_EMAIL_CANDIDATES,
  GENERIC_NAME_CANDIDATES,
  normalizeHeader,
} from './headerProfiles';

export type RowStatus = 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN';

export interface ParsedRow {
  name: string;
  email: string;
  status: RowStatus;
  /** null = pending approval, true = approved, false = declined */
  approved: boolean | null;
  /** True only if the source row had a check-in flag/timestamp. */
  checkedIn: boolean;
  /** Reason this row should be excluded (e.g. 'declined', 'no-rsvp'). */
  skipReason?: 'declined' | 'no-rsvp' | 'no-show';
  /** Validation issues surfaced in the preview UI. */
  errors: string[];
  /** Raw cell values, indexed by lowercased header for the column-mapping UI. */
  raw: Record<string, string>;
}

export interface ColumnMapping {
  nameHeader?: string;
  emailHeader?: string;
  statusHeader?: string;
  firstNameHeader?: string;
  lastNameHeader?: string;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert a header array to a cell-lookup helper.
 *
 * Returns a function that, given a row of cells and a header name, returns
 * the matching cell or '' if absent.
 */
function lookupBuilder(headers: string[]) {
  const lower = headers.map(normalizeHeader);
  return (row: string[], header: string): string => {
    const idx = lower.indexOf(normalizeHeader(header));
    if (idx === -1) return '';
    return (row[idx] || '').trim();
  };
}

/**
 * Find the first header from a candidate list that exists in `headers`.
 * Used by the generic-CSV fallback to discover name/email columns.
 */
function findHeader(headers: string[], candidates: string[]): string | undefined {
  const lower = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return headers[idx];
  }
  // Substring fallback for generic CSVs
  for (let i = 0; i < headers.length; i++) {
    const h = lower[i];
    if (candidates.some((c) => h.includes(c))) return headers[i];
  }
  return undefined;
}

/**
 * Build the default column mapping for a detected platform. Used by the UI
 * to pre-fill the mapping dropdowns; the host can override.
 */
export function defaultMapping(platform: Platform, headers: string[]): ColumnMapping {
  const lower = headers.map(normalizeHeader);
  const find = (cands: string[]): string | undefined => {
    for (const c of cands) {
      const idx = lower.indexOf(c);
      if (idx !== -1) return headers[idx];
    }
    return undefined;
  };

  if (platform === 'csv') {
    return {
      nameHeader: findHeader(headers, GENERIC_NAME_CANDIDATES),
      emailHeader: findHeader(headers, GENERIC_EMAIL_CANDIDATES),
    };
  }

  const profile = getProfile(platform);
  if (!profile) return {};

  return {
    nameHeader: find(profile.nameColumns),
    emailHeader: find(profile.emailColumns),
    statusHeader: profile.statusColumn ? find([profile.statusColumn]) : undefined,
    firstNameHeader: profile.firstNameColumn ? find([profile.firstNameColumn]) : undefined,
    lastNameHeader: profile.lastNameColumn ? find([profile.lastNameColumn]) : undefined,
  };
}

function makeRawMap(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    out[normalizeHeader(headers[i])] = (row[i] || '').trim();
  }
  return out;
}

/** Luma row → ParsedRow */
function parseLumaRow(headers: string[], row: string[], mapping: ColumnMapping): ParsedRow {
  const get = lookupBuilder(headers);
  const name = mapping.nameHeader ? get(row, mapping.nameHeader) : get(row, 'name');
  const email = mapping.emailHeader ? get(row, mapping.emailHeader) : get(row, 'email');
  const approvalStatus = (
    mapping.statusHeader ? get(row, mapping.statusHeader) : get(row, 'approval_status')
  )
    .toLowerCase()
    .replace(/\s+/g, '_');
  const checkedInAt = get(row, 'checked_in_at');

  let status: RowStatus = 'CONFIRMED';
  let approved: boolean | null = true;
  let skipReason: ParsedRow['skipReason'];

  switch (approvalStatus) {
    case 'approved':
      status = 'CONFIRMED';
      approved = true;
      break;
    case 'pending_approval':
    case 'pending':
      status = 'CONFIRMED';
      approved = null;
      break;
    case 'waitlist':
    case 'waitlisted':
      status = 'WAITLISTED';
      approved = null;
      break;
    case 'declined':
      skipReason = 'declined';
      break;
    case '':
      // No approval status column populated — assume confirmed
      break;
    default:
      // Unknown value — treat as confirmed but flag nothing
      break;
  }

  const checkedIn = Boolean(checkedInAt && checkedInAt.trim().length > 0);
  if (checkedIn) {
    status = 'CHECKED_IN';
    approved = true;
  }

  const errors = validateRow(name, email);

  return {
    name,
    email,
    status,
    approved,
    checkedIn,
    skipReason,
    errors,
    raw: makeRawMap(headers, row),
  };
}

/** Meetup row → ParsedRow */
function parseMeetupRow(headers: string[], row: string[], mapping: ColumnMapping): ParsedRow {
  const get = lookupBuilder(headers);
  const name = mapping.nameHeader ? get(row, mapping.nameHeader) : get(row, 'name');
  const email = mapping.emailHeader
    ? get(row, mapping.emailHeader)
    : get(row, 'email address') || get(row, 'email');
  const rsvp = (mapping.statusHeader ? get(row, mapping.statusHeader) : get(row, 'rsvp'))
    .toLowerCase()
    .trim();

  let status: RowStatus = 'CONFIRMED';
  let approved: boolean | null = true;
  let skipReason: ParsedRow['skipReason'];

  switch (rsvp) {
    case 'yes':
      status = 'CONFIRMED';
      approved = true;
      break;
    case 'waitlist':
    case 'waitlisted':
      status = 'WAITLISTED';
      approved = null;
      break;
    case 'no':
      skipReason = 'no-rsvp';
      break;
    default:
      break;
  }

  const errors = validateRow(name, email);
  return {
    name,
    email,
    status,
    approved,
    checkedIn: false,
    skipReason,
    errors,
    raw: makeRawMap(headers, row),
  };
}

/** Eventbrite row → ParsedRow */
function parseEventbriteRow(headers: string[], row: string[], mapping: ColumnMapping): ParsedRow {
  const get = lookupBuilder(headers);

  const firstHeader = mapping.firstNameHeader || 'first name';
  const lastHeader = mapping.lastNameHeader || 'last name';
  const first = get(row, firstHeader);
  const last = get(row, lastHeader);
  let name = `${first} ${last}`.trim();
  if (!name && mapping.nameHeader) name = get(row, mapping.nameHeader);

  const email = mapping.emailHeader ? get(row, mapping.emailHeader) : get(row, 'email');
  const attendeeStatus = (
    mapping.statusHeader ? get(row, mapping.statusHeader) : get(row, 'attendee status')
  )
    .toLowerCase()
    .trim();

  let status: RowStatus = 'CONFIRMED';
  let approved: boolean | null = true;
  let checkedIn = false;
  let skipReason: ParsedRow['skipReason'];

  switch (attendeeStatus) {
    case 'attending':
      status = 'CONFIRMED';
      approved = true;
      break;
    case 'checked in':
      status = 'CHECKED_IN';
      approved = true;
      checkedIn = true;
      break;
    case 'not attending':
      skipReason = 'no-rsvp';
      break;
    default:
      break;
  }

  const errors = validateRow(name, email);
  return {
    name,
    email,
    status,
    approved,
    checkedIn,
    skipReason,
    errors,
    raw: makeRawMap(headers, row),
  };
}

/** Generic CSV row → ParsedRow */
function parseGenericRow(headers: string[], row: string[], mapping: ColumnMapping): ParsedRow {
  const get = lookupBuilder(headers);
  const name = mapping.nameHeader ? get(row, mapping.nameHeader) : '';
  const email = mapping.emailHeader ? get(row, mapping.emailHeader) : '';
  const errors = validateRow(name, email);
  return {
    name,
    email,
    status: 'CONFIRMED',
    approved: true,
    checkedIn: false,
    errors,
    raw: makeRawMap(headers, row),
  };
}

function validateRow(name: string, email: string): string[] {
  const errors: string[] = [];
  if (!name || !name.trim()) errors.push('missing name');
  if (email && !EMAIL_REGEX.test(email)) errors.push('bad email');
  return errors;
}

/**
 * Parse rows for a detected platform with a (possibly overridden) column
 * mapping. Returns one ParsedRow per data row (including ones with errors
 * or a skipReason — the UI handles filtering).
 */
export function parseRows(
  headers: string[],
  rows: string[][],
  platform: Platform,
  mapping?: ColumnMapping
): ParsedRow[] {
  const finalMapping = mapping ?? defaultMapping(platform, headers);

  return rows.map((row) => {
    switch (platform) {
      case 'luma':
        return parseLumaRow(headers, row, finalMapping);
      case 'meetup':
        return parseMeetupRow(headers, row, finalMapping);
      case 'eventbrite':
        return parseEventbriteRow(headers, row, finalMapping);
      default:
        return parseGenericRow(headers, row, finalMapping);
    }
  });
}

export { detectPlatform, HEADER_PROFILES };
