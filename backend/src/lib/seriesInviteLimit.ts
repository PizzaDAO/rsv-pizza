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
/** Image uploads: 30/h per user for upload-url and for attach, plus 200 per series per day. */
export const BRAND_ADMIN_UPLOAD_BUCKET = 'series_asset_upload';
export const BRAND_ADMIN_UPLOAD_LIMIT = 30;
export const BRAND_ADMIN_ATTACH_BUCKET = 'series_asset_attach';
export const BRAND_ADMIN_ATTACH_LIMIT = 30;
export const BRAND_ASSET_DAILY_BUCKET = 'series_asset_daily';
export const BRAND_ASSET_DAILY_LIMIT = 200;

/** true = allowed (a slot is reserved), false = over budget. Throws when the store is unavailable. */
export async function reserveUserBucket(bucket: string, userId: string, limit: number): Promise<boolean> {
  const res = await getStore().reserve(
    [{ bucket, key: hashRateKey(`${bucket}:user`, userId), limit }],
    INVITE_ACCEPT_WINDOW_MS,
  );
  return res.ids !== null;
}

/** Reserve one event in `bucket` for an arbitrary key (e.g. a series id) over `windowMs`. Throws when the store is unavailable. */
export async function reserveKeyBucket(bucket: string, key: string, limit: number, windowMs: number): Promise<boolean> {
  const res = await getStore().reserve([{ bucket, key: hashRateKey(`${bucket}:key`, key), limit }], windowMs);
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
