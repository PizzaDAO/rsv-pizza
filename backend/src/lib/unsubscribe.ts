import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC-based signing for per-guest reminder unsubscribe links.
 *
 * Token is base64url(HMAC-SHA256(UNSUBSCRIBE_SECRET, guestId)[0..16]).
 * Verification recomputes and compares in constant time — no DB lookup.
 */

export function signGuestId(guestId: string): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET not configured');
  const mac = createHmac('sha256', secret).update(guestId).digest();
  return mac.subarray(0, 16).toString('base64url');
}

export function verifyGuestSig(guestId: string, sig: string): boolean {
  try {
    const a = Buffer.from(signGuestId(guestId), 'base64url');
    const b = Buffer.from(sig, 'base64url');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildUnsubscribeUrl(guestId: string): string {
  const base = process.env.BACKEND_PUBLIC_URL || 'https://api.rsv.pizza';
  return `${base}/api/reminders/unsubscribe?g=${guestId}&s=${signGuestId(guestId)}`;
}
