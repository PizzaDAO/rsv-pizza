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

/** Per-user hourly write budgets for the brand-admin API (settings/revert are tighter than the rest). */
export const BRAND_ADMIN_SETTINGS_BUCKET = 'series_admin_settings';
export const BRAND_ADMIN_SETTINGS_LIMIT = 60;
export const BRAND_ADMIN_WRITE_BUCKET = 'series_admin_write';
export const BRAND_ADMIN_WRITE_LIMIT = 200;

/** true = allowed (a slot is reserved), false = over budget. Throws when the store is unavailable. */
export async function reserveUserBucket(bucket: string, userId: string, limit: number): Promise<boolean> {
  const res = await getStore().reserve(
    [{ bucket, key: hashRateKey(`${bucket}:user`, userId), limit }],
    INVITE_ACCEPT_WINDOW_MS,
  );
  return res.ids !== null;
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
