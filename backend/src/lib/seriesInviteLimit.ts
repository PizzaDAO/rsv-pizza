/**
 * Accept-invite rate limit: 10 attempts per hour per IP and per user (durable `auth_rate_events`
 * store, bucket `series_invite_accept`). Refusal -> 429; a store outage fails closed (503).
 */
import { prisma } from '../config/database.js';
import { prismaRateStore, hashRateKey, type RateStore } from './authRateLimit.js';
import { normalizeIp } from './normalizeIp.js';

export const INVITE_ACCEPT_BUCKET = 'series_invite_accept';
export const INVITE_ACCEPT_LIMIT = 10;
export const INVITE_ACCEPT_WINDOW_MS = 60 * 60 * 1000;

let store: RateStore | null = null;
export function setInviteLimitStore(s: RateStore | null): void {
  store = s;
}
function getStore(): RateStore {
  return (store ??= prismaRateStore(prisma as any));
}

/** true = allowed (a slot is reserved), false = over budget. Throws when the store is unavailable. */
export async function reserveInviteAccept(ip: string | undefined, userId: string): Promise<boolean> {
  const res = await getStore().reserve(
    [
      { bucket: INVITE_ACCEPT_BUCKET, key: hashRateKey(`${INVITE_ACCEPT_BUCKET}:ip`, normalizeIp(ip)), limit: INVITE_ACCEPT_LIMIT },
      { bucket: INVITE_ACCEPT_BUCKET, key: hashRateKey(`${INVITE_ACCEPT_BUCKET}:user`, userId), limit: INVITE_ACCEPT_LIMIT },
    ],
    INVITE_ACCEPT_WINDOW_MS,
  );
  return res.ids !== null;
}
