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

// ---- RSVP code-step send limits -------------------------------------------------------
//
// The RSVP code step emails an address the CALLER typed, so it must not become a way to
// spam someone's inbox. Two limits, both silent (the RSVP response is the same whether or
// not a code went out; an earlier code stays valid for 15 minutes):
//   - per email + IP: RSVP_CODE_PER_EMAIL_IP sends per RSVP_CODE_WINDOW_MS (in memory,
//     like the express-rate-limit limiters in index.ts);
//   - per email, any IP: no send when RSVP_CODE_PER_EMAIL_HOUR or more sign-in codes (of
//     any origin) were created for it in the last hour. Counted from magic_links, so it
//     holds across instances and restarts.

export const RSVP_CODE_PER_EMAIL_IP = 3;
export const RSVP_CODE_WINDOW_MS = 15 * 60 * 1000;
export const RSVP_CODE_PER_EMAIL_HOUR = 6;

const emailIpSends = new Map<string, number[]>();

/** Test hook. */
export function resetRsvpCodeLimits(): void {
  emailIpSends.clear();
}

/**
 * True (and the send is counted) when another RSVP code may be sent to `email` for a
 * request from `ip`. False means: send nothing, but answer exactly as if one was sent.
 */
export async function takeRsvpCodeSend(email: string, ip: string | undefined): Promise<boolean> {
  const now = Date.now();
  const key = `${email}|${ip ?? '?'}`;
  const recent = (emailIpSends.get(key) ?? []).filter((t) => now - t < RSVP_CODE_WINDOW_MS);
  if (recent.length >= RSVP_CODE_PER_EMAIL_IP) {
    emailIpSends.set(key, recent);
    return false;
  }
  const lastHour = await prisma.magicLink.count({
    where: { email, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
  });
  if (lastHour >= RSVP_CODE_PER_EMAIL_HOUR) {
    emailIpSends.set(key, recent);
    return false;
  }
  recent.push(now);
  emailIpSends.set(key, recent);
  // Keep the map bounded: drop stale keys now and then.
  if (emailIpSends.size > 10_000) {
    for (const [k, ts] of emailIpSends) {
      if (!ts.some((t) => now - t < RSVP_CODE_WINDOW_MS)) emailIpSends.delete(k);
    }
  }
  return true;
}

// ---- Email-bound verification lockout -------------------------------------------------

/** Wrong codes allowed for one email before its outstanding codes lock. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * A wrong code was entered for `email` (email-bound /verify-code). Count it on that email's
 * live codes and lock them at MAX_CODE_ATTEMPTS, using the existing magic_links
 * `attempts` / `locked_at` columns (no migration). Without this, a 6-digit code for a known
 * email could be brute-forced in its 15 minutes. Requesting a new code starts fresh.
 */
export async function recordFailedCodeAttempt(email: string): Promise<void> {
  const now = new Date();
  const live = { email, used: false, lockedAt: null, expiresAt: { gt: now } };
  await prisma.magicLink.updateMany({ where: live, data: { attempts: { increment: 1 } } });
  await prisma.magicLink.updateMany({
    where: { ...live, attempts: { gte: MAX_CODE_ATTEMPTS } },
    data: { lockedAt: now },
  });
}
