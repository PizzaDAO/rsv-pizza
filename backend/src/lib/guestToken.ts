/**
 * rsvp-overwrite-fix: per-guest capability token.
 *
 * Guest ids leaked for months through the anon `guests` grant (guests-anon-exposure), and
 * ids can't be rotated (11 FKs reference guests.id). So a raw guest id must never be enough
 * to act as a guest. Guest-scoped public endpoints (raffle entry, quiz answers, venue
 * discount, NFT bookkeeping, resend-confirmation) now require one of:
 *   - a JWT whose email is the guest's email (the guest, logged in), or
 *   - this token, which is only ever handed to the RSVPer in the RSVP response, to the
 *     owner via GET /api/parties/:id/my-guest. It is deliberately NOT put in emailed links:
 *     the email QR image is rendered by a third-party QR service, which would see it.
 *
 * Stateless: HMAC-SHA256 over the guest id with a domain-separated key derived from
 * JWT_SECRET, so no DB column or migration is needed. Rotating JWT_SECRET invalidates every
 * outstanding guest token (and every login), which is the intended blast radius.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { getJwtSecret } from '../config/secrets.js';

const DOMAIN = 'rsvp-guest-capability:v1:';
/** 24 bytes of HMAC, base64url (32 chars). Unguessable; short enough for a URL. */
const TOKEN_BYTES = 24;

export function signGuestToken(guestId: string): string {
  const mac = createHmac('sha256', getJwtSecret()).update(DOMAIN + guestId).digest();
  return mac.subarray(0, TOKEN_BYTES).toString('base64url');
}

export function verifyGuestToken(guestId: string | null | undefined, token: unknown): boolean {
  if (!guestId || typeof token !== 'string' || token.length === 0 || token.length > 128) return false;
  const expected = Buffer.from(signGuestToken(guestId), 'utf8');
  const given = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The token from (in order) the `X-Guest-Token` header, body `guestToken`, or query `t`. */
export function guestTokenFromRequest(req: Request): string | undefined {
  const header = req.headers['x-guest-token'];
  if (typeof header === 'string' && header) return header;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.guestToken === 'string' && body.guestToken) return body.guestToken;
  const q = req.query?.t;
  if (typeof q === 'string' && q) return q;
  return undefined;
}

/**
 * True when the caller may act as this guest: a valid guest token for this id, or a verified
 * JWT (populated by optionalAuth/requireAuth) whose email is the guest's email.
 */
export function callerOwnsGuest(
  req: Request & { userEmail?: string },
  guest: { id: string; email: string | null },
): boolean {
  if (verifyGuestToken(guest.id, guestTokenFromRequest(req))) return true;
  const caller = req.userEmail?.trim().toLowerCase();
  const owner = guest.email?.trim().toLowerCase();
  return !!caller && !!owner && caller === owner;
}

