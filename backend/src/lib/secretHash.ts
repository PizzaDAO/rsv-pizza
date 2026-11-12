/**
 * party-password-hash: event, report and venue-report passwords are stored as bcrypt hashes.
 *
 * Transition: rows written before the backfill (`backend/scripts/apply-hash-party-passwords.cjs`)
 * still hold plaintext. `verifySecret` falls back to a constant-time compare for those and logs
 * `[secretHash] legacy plaintext compare` so we can tell when the backfill is complete. PR4
 * (`party-password-hash-enforce`) removes the fallback.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const COST = 10;

export function isBcryptHash(s: unknown): s is string {
  return typeof s === 'string' && BCRYPT_RE.test(s);
}

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

function sha256(s: string): Buffer {
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}

/**
 * True when `attempt` matches the stored secret. A null/empty stored value never matches:
 * callers keep their own "no password set" semantics.
 */
export async function verifySecret(stored: string | null | undefined, attempt: string): Promise<boolean> {
  if (!stored || typeof attempt !== 'string') return false;
  if (isBcryptHash(stored)) {
    return bcrypt.compare(attempt, stored);
  }
  console.warn('[secretHash] legacy plaintext compare');
  return crypto.timingSafeEqual(sha256(stored), sha256(attempt));
}

/**
 * Turn a request-body password into the value to write.
 *  - undefined  -> undefined (leave the column unchanged)
 *  - null / ''  -> null (clear)
 *  - string     -> bcrypt hash
 * Anything else (numbers, objects) is coerced with String() first, matching the old `password || null`
 * write which stored whatever came in.
 */
export async function secretForWrite(input: unknown): Promise<string | null | undefined> {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const s = String(input);
  if (s === '') return null;
  return hashSecret(s);
}

/**
 * Strip the three party secrets (hash or legacy plaintext) from an object headed for an API
 * response or webhook, replacing each one that was present with a boolean flag:
 * `password` -> `hasPassword`, `reportPassword` -> `hasReportPassword`,
 * `venueReportPassword` -> `hasVenueReportPassword`. Keys that were absent (a narrow `select`)
 * stay absent, so a missing field is never reported as "no password".
 */
export function redactPartySecrets<T>(party: T): Omit<T, 'password' | 'reportPassword' | 'venueReportPassword'> & {
  hasPassword?: boolean;
  hasReportPassword?: boolean;
  hasVenueReportPassword?: boolean;
} {
  if (!party || typeof party !== 'object') return party as any;
  const src = party as Record<string, unknown>;
  const { password, reportPassword, venueReportPassword, ...rest } = src;
  const out: Record<string, unknown> = { ...rest };
  if ('password' in src) out.hasPassword = !!password;
  if ('reportPassword' in src) out.hasReportPassword = !!reportPassword;
  if ('venueReportPassword' in src) out.hasVenueReportPassword = !!venueReportPassword;
  return out as any;
}
