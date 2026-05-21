/**
 * Canonical CSV header sets per platform.
 *
 * Each profile lists `required` headers — every one must be present (case-
 * insensitive match) for detectPlatform() to choose that platform. `optional`
 * headers are not used for detection but are documented here for the
 * row-parser.
 *
 * Headers were derived from the canonical exports of each platform as of
 * late 2025/early 2026. Add aliases here when a real export differs — the
 * detection logic uses lowercase-trim equality, so casing/spacing variants
 * are normalized.
 */

export type Platform = 'luma' | 'meetup' | 'eventbrite' | 'csv';

export interface HeaderProfile {
  platform: Platform;
  /** Every header in this list (lowercased) must appear in the CSV. */
  required: string[];
  /** Optional headers (documentation only). */
  optional?: string[];
  /** Field-to-column candidates the parser tries (in order). */
  nameColumns: string[];
  emailColumns: string[];
  /** Status / approval column for Luma + Meetup + Eventbrite. */
  statusColumn?: string;
  /** Checked-in flag column (Eventbrite uses Attendee Status; Luma a timestamp). */
  checkedInColumn?: string;
  /** For Eventbrite where name is split across two columns. */
  firstNameColumn?: string;
  lastNameColumn?: string;
}

export const HEADER_PROFILES: HeaderProfile[] = [
  {
    platform: 'luma',
    required: ['approval_status', 'email'],
    optional: ['name', 'ticket_type', 'checked_in_at', 'created_at'],
    nameColumns: ['name', 'full name'],
    emailColumns: ['email'],
    statusColumn: 'approval_status',
    checkedInColumn: 'checked_in_at',
  },
  {
    platform: 'meetup',
    required: ['rsvp', 'user id'],
    optional: ['name', 'email address', 'guests', 'rsvped on'],
    nameColumns: ['name'],
    emailColumns: ['email address', 'email'],
    statusColumn: 'rsvp',
  },
  {
    platform: 'eventbrite',
    required: ['order #', 'attendee status'],
    optional: ['first name', 'last name', 'email', 'ticket type'],
    nameColumns: ['name'], // fallback if first+last absent
    firstNameColumn: 'first name',
    lastNameColumn: 'last name',
    emailColumns: ['email'],
    statusColumn: 'attendee status',
    checkedInColumn: 'attendee status', // value 'Checked In' implies checked-in
  },
];

/** Generic CSV fallback heuristic: any header containing these substrings. */
export const GENERIC_NAME_CANDIDATES = ['name', 'full name', 'fullname'];
export const GENERIC_EMAIL_CANDIDATES = ['email', 'e-mail', 'mail'];

/** Normalize a header cell to its detection form. */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

/**
 * Detect the source platform from a header row.
 * Returns 'csv' (generic) when no profile fully matches.
 */
export function detectPlatform(headers: string[]): Platform {
  const lower = headers.map(normalizeHeader);
  for (const profile of HEADER_PROFILES) {
    if (profile.required.every((req) => lower.includes(req))) {
      return profile.platform;
    }
  }
  return 'csv';
}

export function getProfile(platform: Platform): HeaderProfile | null {
  return HEADER_PROFILES.find((p) => p.platform === platform) ?? null;
}
