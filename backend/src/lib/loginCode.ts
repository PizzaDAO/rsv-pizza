/**
 * invite-verify: the 6-digit sign-in code, shared by
 *   - POST /api/auth/magic-link (the normal "log in" flow), and
 *   - the RSVP form's inline code step (POST /api/rsvp/:code/guest answers
 *     `verificationRequired` when a non-owner submits an email already on the party).
 * Both send the SAME email (the existing "<Site> Code 123456" sign-in email). There is no
 * new email type. Entering the code logs the person in (POST /api/auth/verify-code), after
 * which the RSVP is retried as the logged-in owner of that email.
 */
import { randomBytes } from 'crypto';
import { prisma } from '../config/database.js';
import type { SiteBrand } from './siteBrand.js';
import { AppError } from '../middleware/error.js';
import {
  CLEANUP_CHANCE,
  RATE_EVENT_RETENTION_MS,
  hashRateKey,
  memoryRateStore,
  prismaRateStore,
  type RateBucket,
  type RateStore,
  type Reservation,
} from './authRateLimit.js';

// Helper function to send magic link email (moved verbatim from auth.routes.ts)
export async function sendMagicLinkEmail(email: string, magicLinkUrl: string, code: string, resendApiKey: string, site: SiteBrand) {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign In to ${site.name}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 Sign In to ${site.name}</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">Enter this code to sign in:</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
          <p style="margin: 0 0 15px 0; font-size: 14px; color: #666; font-weight: 600;">YOUR SIGN-IN CODE</p>
          <div style="font-size: 48px; font-weight: 700; letter-spacing: 8px; color: #ff393a; margin: 10px 0;">${code}</div>
          <p style="margin: 15px 0 0 0; font-size: 13px; color: #999;">This code expires in 15 minutes</p>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
          <p style="margin-top: 20px;">
            If you didn't request this email, you can safely ignore it.
          </p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: site.fromEmail,
      to: [email],
      subject: `${site.name} Code ${code}`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return response.json();
}

/**
 * Create a MagicLink row (token + unique 6-digit code, 15 min) for `email` (already
 * normalized) and send the sign-in email. Email failures are logged, never thrown, matching
 * the old inline behaviour of /magic-link.
 */
/**
 * Wallet hand-off rows (POST /api/auth/handoff, #1252) share the magic_links table; their
 * `code` is `ho…`, never 6 digits. They are not sign-in codes: never re-send one, and don't
 * let them count toward or receive the sign-in-code budgets and signals.
 */
export const HANDOFF_CODE_PREFIX = 'ho';
const NOT_HANDOFF = { NOT: [{ code: { startsWith: HANDOFF_CODE_PREFIX } }] };

export async function issueLoginCode(
  email: string,
  site: SiteBrand,
  userId?: string | null,
): Promise<{ magicLinkUrl: string }> {
  // Security review: cap how many DIFFERENT codes can be live for one email. Every live code
  // is another target for a guesser, so once MINT_PER_EMAIL_WINDOW codes were created for this
  // email in the last 15 minutes, re-send the newest still-usable one instead of minting a
  // new one. The requester still gets a working code (no denial of service), but an attacker
  // can't multiply the victim's live codes by requesting from many IPs.
  const now = new Date();
  const recentMints = await prisma.magicLink.count({
    where: { email, createdAt: { gte: new Date(now.getTime() - LIMIT_WINDOW_MS) }, ...NOT_HANDOFF },
  });
  if (recentMints >= MINT_PER_EMAIL_WINDOW) {
    // Only ever re-send a real 6-digit sign-in code, never a wallet hand-off row.
    const live = await prisma.magicLink.findFirst({
      where: { email, used: false, lockedAt: null, expiresAt: { gt: now }, ...NOT_HANDOFF },
      orderBy: { createdAt: 'desc' },
    });
    if (live) {
      const liveUrl = `${site.url}/auth/verify?token=${live.token}`;
      const key = process.env.RESEND_API_KEY;
      if (key) {
        try {
          await sendMagicLinkEmail(email, liveUrl, live.code, key, site);
        } catch (emailError) {
          console.error('Failed to send magic link email:', emailError);
        }
      }
      return { magicLinkUrl: liveUrl };
    }
  }

  // Generate secure token
  const token = randomBytes(32).toString('hex');

  // Generate unique 6-digit code
  let code = '';
  let codeExists = true;
  while (codeExists) {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await prisma.magicLink.findUnique({ where: { code } });
    codeExists = !!existing;
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Create magic link record
  await prisma.magicLink.create({
    data: {
      token,
      code,
      email,
      expiresAt,
      userId: userId ?? undefined,
    },
  });

  const magicLinkUrl = `${site.url}/auth/verify?token=${token}`;

  // Log for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n========================================');
    console.log('Magic Link (dev mode):');
    console.log(magicLinkUrl);
    console.log('========================================\n');
  }

  // Send email via Resend
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      // mushroom-48468: use normalized lowercase for `to:` field
      await sendMagicLinkEmail(email, magicLinkUrl, code, resendApiKey, site);
    } catch (emailError) {
      console.error('Failed to send magic link email:', emailError);
      // Don't fail the request if email fails
    }
  }

  return { magicLinkUrl };
}

// ---- Limits ---------------------------------------------------------------------------
//
// Design rule (security review of #1253): nothing an attacker does may lock or exhaust the
// VICTIM's own ability to get or use a code. So every budget is charged to the CALLER
// (email + IP, or IP), never to the stored code rows. Per-email budgets only tighten what
// each caller gets; they never refuse a caller who hasn't used their own share.
//
// durable-rate-limits: the per-IP and per-(email, IP) counters live in Postgres
// (`auth_rate_events`, lib/authRateLimit.ts), so they are GLOBAL across serverless instances;
// keys are HMAC digests, never plaintext. Per-email signals are counted from magic_links, as
// before. Each instance also keeps an in-memory copy of its OWN reservations as a fast path:
// its counts are a subset of the global ones, so it only ever refuses requests the DB would
// refuse too (it saves a round trip on a burst, and is the floor sends fall back to).
//
// If the rate-limit query itself fails:
//   - sends FAIL OPEN to the in-memory per-instance budget (the #1253 behaviour) and log.
//     A send is not a guess: the number of live codes per email is capped durably by the mint
//     cap (magic_links), and every guess is still charged to the verify budget below. Failing
//     closed would stop every sign-in email (a full login outage) over a counter table.
//   - verify FAILS CLOSED (503, nothing looked up). This is the brute-force surface: failing
//     open would quietly give every instance its own budget again, exactly what this change
//     removes, and nobody would notice. Verify needs the same database for the code lookup,
//     so an outage that breaks the counter mostly breaks verify anyway.

export const LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** At most this many distinct codes minted per email per 15 min (= code lifetime); then re-send. */
export const MINT_PER_EMAIL_WINDOW = 3;

/** Sign-in code sends (POST /api/auth/magic-link and the RSVP code step share these). */
export const SEND_PER_EMAIL_IP = 3; // per (email, IP) per 15 min
export const SEND_PER_EMAIL_HOUR = 10; // per email, any IP; above it each (email, IP) gets 1 per 15 min

/** Wrong codes at POST /api/auth/verify-code. */
export const FAIL_PER_IP = 40; // email-bound checks: per IP per 15 min, all emails (generous for shared NAT)
// Legacy code-only checks (no email; only old cached bundles still send them) get their own,
// low per-IP budget, separate from the email-bound one.
// TODO(invite-verify, added 2026-11-14): remove the code-only path from /verify-code after
// 2026-11-28, once bundles cached from before PR #1253 have aged out. Every current caller
// (AuthVerifyPage, GPP landing, RSVP code step) sends the email.
export const FAIL_PER_IP_CODE_ONLY = 10;
export const FAIL_PER_EMAIL_IP = 5; // per (email, IP) per 15 min, email-bound checks
export const EMAIL_UNDER_ATTACK_FAILS = 25; // wrong codes on an email's live codes, any IP
export const FAIL_PER_EMAIL_IP_UNDER_ATTACK = 1; // per (email, IP) once the email is under attack

/** `auth_rate_events.bucket` values. */
export const RATE_BUCKETS = {
  send: 'send', // key: email|ip
  verifyIp: 'verify_ip', // key: ip (email-bound checks)
  verifyIpCodeOnly: 'verify_ip_code_only', // key: ip (legacy code-only checks)
  verifyEmailIp: 'verify_email_ip', // key: email|ip
} as const;

let store: RateStore = prismaRateStore(prisma);
let random: () => number = Math.random;

const sendLog = new Map<string, number[]>(); // `${email}|${ip}` -> this instance's send times
const failLog = new Map<string, number[]>(); // `ip|${ip}`, `ipc|${ip}`, `${email}|${ip}` -> failure times

/**
 * Refusal cache: after the DB refuses a key (bucket full), this instance refuses that key
 * locally until the bucket's oldest event ages out, capped at REFUSAL_CACHE_MAX_MS, so an
 * over-budget burst doesn't hit the DB on every request. Strictly an extra limit: the only
 * way it is stricter than the DB is when a slot is RELEASED (a right code) on another
 * instance meanwhile; the cap bounds that to 30 s, and only for a caller already at its limit.
 * Keys: `s|${email}|${ip}` (send) and the failLog keys.
 */
export const REFUSAL_CACHE_MAX_MS = 30_000;
const refusedUntil = new Map<string, number>();

function isRefused(key: string, now: number): boolean {
  const until = refusedUntil.get(key);
  if (until === undefined) return false;
  if (until > now) return true;
  refusedUntil.delete(key);
  return false;
}

function cacheRefusal(key: string, retryAfterMs: number | null | undefined, now: number): void {
  const ms = Math.min(retryAfterMs ?? REFUSAL_CACHE_MAX_MS, REFUSAL_CACHE_MAX_MS);
  if (ms <= 0) return;
  if (refusedUntil.size > 20_000) {
    for (const [k, v] of refusedUntil) if (v <= now) refusedUntil.delete(k);
  }
  refusedUntil.set(key, now + ms);
}

/** Cache a refusal for each bucket that was at its limit. `localKeys[i]` matches `buckets[i]`. */
function cacheFullBuckets(res: Reservation, buckets: RateBucket[], localKeys: string[], now: number): void {
  buckets.forEach((b, i) => {
    if (res.counts[i] >= b.limit) cacheRefusal(localKeys[i], res.retryAfterMs?.[i], now);
  });
}

/**
 * Test hook: clear this instance's in-memory counters and use `opts.store` (default: a fresh
 * in-process store) instead of the database. Production never calls it.
 */
export function resetCodeLimits(opts: { store?: RateStore; random?: () => number } = {}): void {
  sendLog.clear();
  failLog.clear();
  refusedUntil.clear();
  store = opts.store ?? memoryRateStore();
  random = opts.random ?? Math.random;
}

function recent(map: Map<string, number[]>, key: string, now: number): number[] {
  const ts = (map.get(key) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
  map.set(key, ts);
  if (map.size > 20_000) {
    for (const [k, v] of map) if (!v.some((t) => now - t < LIMIT_WINDOW_MS)) map.delete(k);
  }
  return ts;
}

function rollback(map: Map<string, number[]>, key: string, stamp: number) {
  const ts = map.get(key);
  if (!ts) return;
  const i = ts.lastIndexOf(stamp);
  if (i >= 0) ts.splice(i, 1);
}

/** Global reservation; on ~1% of calls also delete events past retention (cheap, small table). */
async function reserveGlobal(buckets: RateBucket[]): Promise<Reservation> {
  const res = await store.reserve(buckets, LIMIT_WINDOW_MS);
  if (random() < CLEANUP_CHANCE) {
    try {
      await store.cleanup(RATE_EVENT_RETENTION_MS);
    } catch (err) {
      console.error('[auth-rate] cleanup failed:', err);
    }
  }
  return res;
}

async function releaseGlobal(ids: string[] | null): Promise<void> {
  if (!ids?.length) return;
  try {
    await store.release(ids);
  } catch (err) {
    // The slot just stays charged until it ages out: conservative, never a bypass.
    console.error('[auth-rate] release failed:', err);
  }
}

/**
 * Reserve one sign-in code send to `email` for a caller at `ip`. Returns false (nothing
 * reserved) when this caller is over budget:
 *   - SEND_PER_EMAIL_IP per 15 min for this (email, IP), counted across all instances;
 *   - when the email already had SEND_PER_EMAIL_HOUR codes in the last hour (anyone's
 *     requests, from magic_links), only a caller with NO send in the last 15 min gets one.
 * So an attacker spamming the address from a few IPs is capped at about one email per IP
 * per 15 min, and the real owner (whose IP hasn't asked) still gets their code.
 *
 * The reservation is taken atomically before the magic_links check and rolled back if that
 * check refuses. If the rate-limit table can't be reached this fails open to the in-memory
 * per-instance budget (see the note above).
 */
export async function takeCodeSend(email: string, ip: string | undefined): Promise<boolean> {
  const now = Date.now();
  const raw = `${email}|${ip ?? '?'}`;
  const ts = recent(sendLog, raw, now);
  if (ts.length >= SEND_PER_EMAIL_IP) return false; // fast path: this instance alone is over
  const refusalKey = `s|${raw}`;
  if (isRefused(refusalKey, now)) return false; // fast path: the DB refused this key recently
  const localCount = ts.length;
  ts.push(now); // reserve locally before awaiting

  let ids: string[] | null = null;
  let mine = localCount;
  try {
    const buckets = [{ bucket: RATE_BUCKETS.send, key: hashRateKey(RATE_BUCKETS.send, raw), limit: SEND_PER_EMAIL_IP }];
    const res = await reserveGlobal(buckets);
    if (!res.ids) {
      rollback(sendLog, raw, now);
      cacheFullBuckets(res, buckets, [refusalKey], now);
      return false;
    }
    ids = res.ids;
    mine = Math.max(res.counts[0], localCount);
  } catch (err) {
    console.error('[auth-rate] send limit check failed; falling back to the per-instance limit:', err);
  }

  let lastHour: number;
  try {
    lastHour = await prisma.magicLink.count({
      where: { email, createdAt: { gte: new Date(now - 60 * 60 * 1000) }, ...NOT_HANDOFF },
    });
  } catch (err) {
    rollback(sendLog, raw, now);
    await releaseGlobal(ids);
    throw err;
  }
  if (lastHour >= SEND_PER_EMAIL_HOUR && mine > 0) {
    rollback(sendLog, raw, now);
    await releaseGlobal(ids);
    return false;
  }
  return true;
}

/**
 * Wrong-code budget (reserveVerifyAttempt below). Checked BEFORE the code is looked up, so a refused
 * caller learns nothing about whether their guess was right. Refuses only this caller:
 *   - FAIL_PER_IP wrong email-bound codes from this IP in 15 min (any email), or
 *     FAIL_PER_IP_CODE_ONLY legacy code-only ones (a separate bucket);
 *   - for an email-bound check, FAIL_PER_EMAIL_IP wrong codes for this (email, IP), or
 *     just FAIL_PER_EMAIL_IP_UNDER_ATTACK once the email's live codes have collected
 *     EMAIL_UNDER_ATTACK_FAILS wrong guesses from anyone. A caller with no failures of
 *     their own (e.g. the real owner, from their own IP) is never refused by that.
 * All of these count across every instance (auth_rate_events).
 */
export interface VerifyAttempt {
  /** The code was right (or the failure shouldn't count): give the reserved slot back. */
  release(): Promise<void>;
  /** The code was wrong: the reserved slot stays as the failure; bump the durable signal. */
  fail(): Promise<void>;
}

/**
 * Reserve one code check for this caller, or null when they're over budget. The slot is
 * reserved atomically across instances under the IP bucket and (email-bound) the
 * email+IP bucket, so a burst of parallel requests, on any number of instances, can't all
 * pass the check before any failure is recorded. A wrong code keeps the slot (it IS the
 * failure); a right code releases it. Throws a 503 AppError (fails closed) when the
 * rate-limit table can't be reached.
 */
export async function reserveVerifyAttempt(ip: string | undefined, email?: string | null): Promise<VerifyAttempt | null> {
  const now = Date.now();
  const ipRaw = ip ?? '?';
  const ipKey = email ? `ip|${ipRaw}` : `ipc|${ipRaw}`; // code-only: own bucket
  const emailKey = email ? `${email}|${ipRaw}` : null;
  const ipLimit = email ? FAIL_PER_IP : FAIL_PER_IP_CODE_ONLY;

  // Fast path: this instance's own reservations already exceed a budget.
  const ipTs = recent(failLog, ipKey, now);
  if (ipTs.length >= ipLimit) return null;
  if (emailKey && recent(failLog, emailKey, now).length >= FAIL_PER_EMAIL_IP) return null;
  if (isRefused(ipKey, now) || (emailKey && isRefused(emailKey, now))) return null; // DB refused recently
  ipTs.push(now);
  if (emailKey) recent(failLog, emailKey, now).push(now);
  const releaseLocal = () => {
    rollback(failLog, ipKey, now);
    if (emailKey) rollback(failLog, emailKey, now);
  };

  const ipBucket = email ? RATE_BUCKETS.verifyIp : RATE_BUCKETS.verifyIpCodeOnly;
  const buckets: RateBucket[] = [{ bucket: ipBucket, key: hashRateKey(ipBucket, ipRaw), limit: ipLimit }];
  if (email) {
    buckets.push({
      bucket: RATE_BUCKETS.verifyEmailIp,
      key: hashRateKey(RATE_BUCKETS.verifyEmailIp, `${email}|${ipRaw}`),
      limit: FAIL_PER_EMAIL_IP,
    });
  }
  let res: Reservation;
  try {
    res = await reserveGlobal(buckets);
  } catch (err) {
    releaseLocal();
    console.error('[auth-rate] verify limit check failed; refusing (fail closed):', err);
    throw new AppError('Sign-in is temporarily unavailable. Try again in a minute.', 503, 'RATE_LIMIT_UNAVAILABLE');
  }
  if (!res.ids) {
    releaseLocal();
    cacheFullBuckets(res, buckets, emailKey ? [ipKey, emailKey] : [ipKey], now);
    return null;
  }
  const ids = res.ids;
  const release = async () => {
    releaseLocal();
    await releaseGlobal(ids);
    // A slot just freed up: don't keep refusing these keys from the cache.
    refusedUntil.delete(ipKey);
    if (emailKey) refusedUntil.delete(emailKey);
  };

  const mine = email ? res.counts[1] : 0; // this (email, IP)'s failures, all instances
  if (email && mine >= FAIL_PER_EMAIL_IP_UNDER_ATTACK) {
    let underAttack = 0;
    try {
      underAttack = await prisma.magicLink.count({
        where: {
          email,
          used: false,
          expiresAt: { gt: new Date(now) },
          attempts: { gte: EMAIL_UNDER_ATTACK_FAILS },
          ...NOT_HANDOFF,
        },
      });
    } catch (err) {
      await release();
      throw err;
    }
    if (underAttack > 0) {
      await release();
      return null;
    }
  }

  return {
    release,
    // For an email-bound check also bump `attempts` on that email's live codes as the
    // cross-instance "under attack" signal. Never sets locked_at or disables codes, so
    // wrong guesses can't lock the owner out.
    fail: async () => {
      if (!email) return;
      await prisma.magicLink.updateMany({
        where: { email, used: false, expiresAt: { gt: new Date(now) }, ...NOT_HANDOFF },
        data: { attempts: { increment: 1 } },
      });
    },
  };
}
