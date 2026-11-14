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
    where: { email, createdAt: { gte: new Date(now.getTime() - LIMIT_WINDOW_MS) } },
  });
  if (recentMints >= MINT_PER_EMAIL_WINDOW) {
    const live = await prisma.magicLink.findFirst({
      where: { email, used: false, lockedAt: null, expiresAt: { gt: now } },
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
// Counters keyed by IP live in memory (like the express-rate-limit limiters in index.ts),
// so on a serverless deploy each warm instance keeps its own; per-email signals are counted
// from magic_links, so they hold across instances.

export const LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** At most this many distinct codes minted per email per 15 min (= code lifetime); then re-send. */
export const MINT_PER_EMAIL_WINDOW = 3;

/** Sign-in code sends (POST /api/auth/magic-link and the RSVP code step share these). */
export const SEND_PER_EMAIL_IP = 3; // per (email, IP) per 15 min
export const SEND_PER_EMAIL_HOUR = 10; // per email, any IP; above it each (email, IP) gets 1 per 15 min

/** Wrong codes at POST /api/auth/verify-code. */
export const FAIL_PER_IP = 40; // per IP per 15 min, both paths (generous for shared NAT, e.g. venue wifi)
export const FAIL_PER_EMAIL_IP = 5; // per (email, IP) per 15 min, email-bound checks
export const EMAIL_UNDER_ATTACK_FAILS = 25; // wrong codes on an email's live codes, any IP
export const FAIL_PER_EMAIL_IP_UNDER_ATTACK = 1; // per (email, IP) once the email is under attack

const sendLog = new Map<string, number[]>(); // `${email}|${ip}` -> send times
const failLog = new Map<string, number[]>(); // `ip|${ip}` and `${email}|${ip}` -> failure times

/** Test hook. */
export function resetCodeLimits(): void {
  sendLog.clear();
  failLog.clear();
}

function recent(map: Map<string, number[]>, key: string, now: number): number[] {
  const ts = (map.get(key) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
  map.set(key, ts);
  if (map.size > 20_000) {
    for (const [k, v] of map) if (!v.some((t) => now - t < LIMIT_WINDOW_MS)) map.delete(k);
  }
  return ts;
}

/**
 * Reserve one sign-in code send to `email` for a caller at `ip`. Returns false (nothing
 * reserved) when this caller is over budget:
 *   - SEND_PER_EMAIL_IP per 15 min for this (email, IP);
 *   - when the email already had SEND_PER_EMAIL_HOUR codes in the last hour (anyone's
 *     requests, from magic_links), only a caller with NO send in the last 15 min gets one.
 * So an attacker spamming the address from a few IPs is capped at about one email per IP
 * per 15 min, and the real owner (whose IP hasn't asked) still gets their code.
 *
 * The reservation is taken synchronously before the DB await and rolled back if the DB
 * check refuses, so concurrent requests can't all pass the in-memory check at once.
 */
export async function takeCodeSend(email: string, ip: string | undefined): Promise<boolean> {
  const now = Date.now();
  const key = `${email}|${ip ?? '?'}`;
  const ts = recent(sendLog, key, now);
  if (ts.length >= SEND_PER_EMAIL_IP) return false;
  const hadRecentSend = ts.length > 0;
  ts.push(now); // reserve before awaiting
  let lastHour: number;
  try {
    lastHour = await prisma.magicLink.count({
      where: { email, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    });
  } catch (err) {
    rollback(sendLog, key, now);
    throw err;
  }
  if (lastHour >= SEND_PER_EMAIL_HOUR && hadRecentSend) {
    rollback(sendLog, key, now);
    return false;
  }
  return true;
}

function rollback(map: Map<string, number[]>, key: string, stamp: number) {
  const ts = map.get(key);
  if (!ts) return;
  const i = ts.lastIndexOf(stamp);
  if (i >= 0) ts.splice(i, 1);
}

/**
 * Wrong-code budget (reserveVerifyAttempt below). Checked BEFORE the code is looked up, so a refused
 * caller learns nothing about whether their guess was right. Refuses only this caller:
 *   - FAIL_PER_IP wrong codes from this IP in 15 min (any email, either path);
 *   - for an email-bound check, FAIL_PER_EMAIL_IP wrong codes for this (email, IP), or
 *     just FAIL_PER_EMAIL_IP_UNDER_ATTACK once the email's live codes have collected
 *     EMAIL_UNDER_ATTACK_FAILS wrong guesses from anyone. A caller with no failures of
 *     their own (e.g. the real owner, from their own IP) is never refused by that.
 */
export interface VerifyAttempt {
  /** The code was right (or the failure shouldn't count): give the reserved slot back. */
  release(): void;
  /** The code was wrong: the reserved slot stays as the failure; bump the durable signal. */
  fail(): Promise<void>;
}

/**
 * Reserve one code check for this caller, or null when they're over budget. The slot is
 * taken SYNCHRONOUSLY (before any await) under both `ip|…` and `email|ip` keys, so a burst
 * of parallel requests can't all pass the check before any failure is recorded. A wrong
 * code keeps the slot (it IS the failure); a right code releases it.
 */
export async function reserveVerifyAttempt(ip: string | undefined, email?: string | null): Promise<VerifyAttempt | null> {
  const now = Date.now();
  const ipKey = `ip|${ip ?? '?'}`;
  const emailKey = email ? `${email}|${ip ?? '?'}` : null;
  const ipTs = recent(failLog, ipKey, now);
  if (ipTs.length >= FAIL_PER_IP) return null;
  let mine = 0;
  if (emailKey) {
    const ts = recent(failLog, emailKey, now);
    mine = ts.length;
    if (mine >= FAIL_PER_EMAIL_IP) return null;
    ts.push(now);
  }
  ipTs.push(now);
  const release = () => {
    rollback(failLog, ipKey, now);
    if (emailKey) rollback(failLog, emailKey, now);
  };

  if (email && mine >= FAIL_PER_EMAIL_IP_UNDER_ATTACK) {
    let underAttack = 0;
    try {
      underAttack = await prisma.magicLink.count({
        where: {
          email,
          used: false,
          expiresAt: { gt: new Date(now) },
          attempts: { gte: EMAIL_UNDER_ATTACK_FAILS },
        },
      });
    } catch (err) {
      release();
      throw err;
    }
    if (underAttack > 0) {
      release();
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
        where: { email, used: false, expiresAt: { gt: new Date(now) } },
        data: { attempts: { increment: 1 } },
      });
    },
  };
}
