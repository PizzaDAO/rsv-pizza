/**
 * margherita-58471: T-4h automated email reminders.
 *
 * Two endpoints on this router:
 *
 *   GET  /api/cron/event-reminders
 *     Vercel-cron entrypoint. Gated by `Authorization: Bearer ${CRON_SECRET}`.
 *     Scans for events with date BETWEEN NOW()+3h45m AND NOW()+4h15m and
 *     `reminders_enabled = TRUE`, then atomically claims approved-and-emailable
 *     guests by setting `reminder_sent_at = NOW()` in a single UPDATE …
 *     RETURNING. Sends reminder emails via Resend with a small concurrency
 *     pool. On send failure, the claim is rolled back so the next 15-minute
 *     tick will retry.
 *
 *   GET / POST /api/reminders/unsubscribe?g=<guestId>&s=<sig>
 *     One-click List-Unsubscribe target. Verifies HMAC-SHA256 over guestId
 *     using UNSUBSCRIBE_SECRET (16-byte truncated, base64url-encoded), then
 *     flips `reminders_unsubscribed = TRUE` and renders a small standalone
 *     confirmation page.
 *
 * Out of scope (intentional): multiple reminders (no 7d / 1h), per-event
 * custom offset, localization, SMS, declined/pending/waitlisted guests,
 * host/co-host recipients (a host who is also a guest will get one — fine),
 * ICS attachments, a reminders log table, re-subscribe UI, open/click pixels,
 * Resend batch sends.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// ---------- HMAC helpers (unsubscribe link signing) ----------

function signGuestId(guestId: string): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET not configured');
  const mac = createHmac('sha256', secret).update(guestId).digest();
  return mac.subarray(0, 16).toString('base64url');
}

function verifyGuestSig(guestId: string, sig: string): boolean {
  try {
    const a = Buffer.from(signGuestId(guestId), 'base64url');
    const b = Buffer.from(sig, 'base64url');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function buildUnsubscribeUrl(guestId: string): string {
  const base = process.env.BACKEND_PUBLIC_URL || 'https://api.rsv.pizza';
  return `${base}/api/reminders/unsubscribe?g=${guestId}&s=${signGuestId(guestId)}`;
}

// ---------- Concurrency helper ----------

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(
    items.length,
  );
  let next = 0;
  const workers: Array<Promise<void>> = [];
  const workerCount = Math.max(1, Math.min(limit, items.length));

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          try {
            const value = await fn(items[i]);
            results[i] = { ok: true, value };
          } catch (error) {
            results[i] = { ok: false, error };
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ---------- Reminder email content ----------

interface ReminderEventCtx {
  partyId: string;
  partyName: string;
  partyDate: Date;
  partyTimezone: string | null;
  partyAddress: string | null;
  partyVenueName: string | null;
  partyImageUrl: string | null;
  inviteCode: string;
  customUrl: string | null;
}

interface ReminderGuestRow {
  id: string;
  name: string;
  email: string;
  party_id: string;
}

function formatLocalTime(date: Date, timezone: string | null): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || undefined,
  });
}

function shortLocalTime(date: Date, timezone: string | null): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || undefined,
  });
}

function buildAddressText(ctx: ReminderEventCtx): string {
  if (ctx.partyVenueName && ctx.partyAddress) {
    return `${ctx.partyVenueName}, ${ctx.partyAddress}`;
  }
  return ctx.partyVenueName || ctx.partyAddress || 'Location TBD';
}

function buildEventUrl(ctx: ReminderEventCtx): string {
  const slug = ctx.customUrl || ctx.inviteCode;
  return `https://rsv.pizza/${slug}`;
}

function buildReminderHtml(params: {
  guestName: string;
  whenText: string;
  addressText: string;
  partyName: string;
  eventUrl: string;
  unsubUrl: string;
  venueName: string | null;
  address: string | null;
  imageUrl: string | null;
}): string {
  const { guestName, whenText, addressText, partyName, eventUrl, unsubUrl, venueName, address, imageUrl } =
    params;

  const whereHtml = venueName && address
    ? `<p style="margin: 10px 0;"><strong>Where:</strong> ${venueName}<br><span style="color: #666; font-size: 14px;">${address}</span></p>`
    : `<p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>`;

  const flyerBlock = imageUrl
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${imageUrl}" alt="${partyName}" style="max-width: 100%; border-radius: 12px;" /></div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reminder: ${partyName}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${flyerBlock}
        <div style="background: linear-gradient(180deg, #c8e8f2 0%, #9dd5e8 100%); padding: 44px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 38px; font-weight: 900; margin: 0; letter-spacing: 1px; text-shadow: 2px 2px 0 #1a3a4a, 3px 3px 0 #1a3a4a, 4px 4px 0 #1a3a4a;">See you in <span style="color: #ff393a; text-shadow: 2px 2px 0 #ffffff, 3px 3px 0 #ffffff;">4 HOURS!</span></h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">${partyName}</h2>
          <p style="margin: 10px 0;"><strong>When:</strong> ${whenText}</p>
          ${whereHtml}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>See you there, ${guestName}!</p>
        </div>

        <div style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
          <p>You're receiving this because you RSVP'd to ${partyName} on RSV.Pizza.<br>
          <a href="${unsubUrl}" style="color: #999; text-decoration: underline;">Unsubscribe from reminders for this event</a></p>
        </div>
      </body>
    </html>
  `;
}

function buildReminderText(params: {
  guestName: string;
  whenText: string;
  addressText: string;
  partyName: string;
  eventUrl: string;
  unsubUrl: string;
}): string {
  return [
    `Hi ${params.guestName},`,
    '',
    `Quick reminder — ${params.partyName} starts in about 4 hours.`,
    '',
    `When: ${params.whenText}`,
    `Where: ${params.addressText}`,
    '',
    `Event page: ${params.eventUrl}`,
    '',
    `See you there!`,
    '',
    `--`,
    `You're receiving this because you RSVP'd to ${params.partyName} on RSV.Pizza.`,
    `Unsubscribe from reminders for this event: ${params.unsubUrl}`,
  ].join('\n');
}

async function sendReminderEmail(
  guest: ReminderGuestRow,
  ctx: ReminderEventCtx,
  resendApiKey: string,
): Promise<void> {
  const whenText = formatLocalTime(ctx.partyDate, ctx.partyTimezone);
  const timeOnly = shortLocalTime(ctx.partyDate, ctx.partyTimezone);
  const addressText = buildAddressText(ctx);
  const eventUrl = buildEventUrl(ctx);
  const unsubUrl = buildUnsubscribeUrl(guest.id);

  const html = buildReminderHtml({
    guestName: guest.name,
    whenText,
    addressText,
    partyName: ctx.partyName,
    eventUrl,
    unsubUrl,
    venueName: ctx.partyVenueName,
    address: ctx.partyAddress,
    imageUrl: ctx.partyImageUrl,
  });
  const text = buildReminderText({
    guestName: guest.name,
    whenText,
    addressText,
    partyName: ctx.partyName,
    eventUrl,
    unsubUrl,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [guest.email],
      subject: `Tonight at ${timeOnly}: ${ctx.partyName} 🍕`,
      html,
      text,
      headers: {
        // RFC 8058 — Gmail/Outlook one-click unsubscribe support.
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${errorBody}`);
  }
}

// ---------- GET /api/cron/event-reminders ----------

router.get('/cron/event-reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Gate on shared secret. Vercel cron sends this header via the dashboard
    // cron config; manual smoke-tests must send it too. We compare in
    // constant time to avoid leaking the secret via timing.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('CRON_SECRET not configured — refusing to run reminder cron');
      throw new AppError('Cron not configured', 500, 'CONFIG_ERROR');
    }
    const authHeader = req.headers.authorization || '';
    const expected = `Bearer ${cronSecret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    const authed = a.length === b.length && timingSafeEqual(a, b);
    if (!authed) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.warn('RESEND_API_KEY not configured — reminder cron is a no-op');
      res.json({ ok: true, scanned: 0, sent: 0, failed: 0, note: 'RESEND_API_KEY missing' });
      return;
    }

    // Window: T-4h ± 15min. With a 15-minute cron cadence this gives every
    // approved guest exactly one opportunity to be picked up, even if a tick
    // is slightly late. `reminder_sent_at` claim then dedupes if two ticks
    // overlap a single event.
    const now = new Date();
    const windowStart = new Date(now.getTime() + (4 * 60 - 15) * 60 * 1000); // +3h45m
    const windowEnd = new Date(now.getTime() + (4 * 60 + 15) * 60 * 1000);   // +4h15m

    const parties = await prisma.party.findMany({
      where: {
        remindersEnabled: true,
        date: { gte: windowStart, lte: windowEnd },
        cancelledAt: null,
      },
      select: {
        id: true,
        name: true,
        date: true,
        timezone: true,
        address: true,
        venueName: true,
        eventImageUrl: true,
        inviteCode: true,
        customUrl: true,
      },
    });

    if (parties.length === 0) {
      res.json({ ok: true, scanned: 0, sent: 0, failed: 0 });
      return;
    }

    const partyById = new Map(parties.map((p) => [p.id, p]));
    const partyIds = parties.map((p) => p.id);

    // Atomic claim: any guest whose row we update here is OURS to send to.
    // Subsequent ticks will skip them via reminder_sent_at IS NULL.
    const claimed = await prisma.$queryRaw<ReminderGuestRow[]>`
      UPDATE guests
      SET reminder_sent_at = NOW()
      WHERE party_id = ANY(${partyIds}::uuid[])
        AND approved = TRUE
        AND email IS NOT NULL
        AND reminders_unsubscribed = FALSE
        AND reminder_sent_at IS NULL
      RETURNING id, name, email, party_id
    `;

    if (claimed.length === 0) {
      res.json({ ok: true, scanned: parties.length, sent: 0, failed: 0 });
      return;
    }

    const results = await runWithConcurrency(claimed, 5, async (guest) => {
      const party = partyById.get(guest.party_id);
      if (!party || !party.date) {
        throw new Error(`Party context missing for guest ${guest.id}`);
      }
      await sendReminderEmail(
        guest,
        {
          partyId: party.id,
          partyName: party.name,
          partyDate: party.date,
          partyTimezone: party.timezone,
          partyAddress: party.address,
          partyVenueName: party.venueName,
          partyImageUrl: party.eventImageUrl,
          inviteCode: party.inviteCode,
          customUrl: party.customUrl,
        },
        resendApiKey,
      );
      return guest.id;
    });

    // Roll back claims for any send that failed so the next 15-minute tick retries.
    const failedGuestIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.ok) {
        failedGuestIds.push(claimed[i].id);
        console.error(`[reminder-cron] send failed for guest ${claimed[i].id}:`, r.error);
      }
    }
    if (failedGuestIds.length > 0) {
      await prisma.guest.updateMany({
        where: { id: { in: failedGuestIds } },
        data: { reminderSentAt: null },
      });
    }

    res.json({
      ok: true,
      scanned: parties.length,
      sent: claimed.length - failedGuestIds.length,
      failed: failedGuestIds.length,
    });
  } catch (error) {
    next(error);
  }
});

// ---------- GET / POST /api/reminders/unsubscribe ----------

function renderUnsubscribePage(title: string, message: string, ok: boolean): string {
  const accent = ok ? '#4ade80' : '#ff393a';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #1a1a2e; border: 1px solid #222; border-radius: 12px; padding: 40px 32px; max-width: 480px; width: 100%; text-align: center; }
  h1 { color: ${accent}; font-size: 24px; margin: 0 0 12px 0; }
  p { color: #aaa; line-height: 1.6; margin: 0 0 20px 0; }
  a { color: #ff393a; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="https://rsv.pizza">Back to RSV.Pizza</a></p>
  </div>
</body>
</html>`;
}

async function handleUnsubscribe(req: Request, res: Response): Promise<void> {
  const guestId = typeof req.query.g === 'string' ? req.query.g : '';
  const sig = typeof req.query.s === 'string' ? req.query.s : '';

  if (!guestId || !sig) {
    res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        renderUnsubscribePage(
          'Invalid link',
          'This unsubscribe link is missing required parameters.',
          false,
        ),
      );
    return;
  }

  if (!verifyGuestSig(guestId, sig)) {
    res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        renderUnsubscribePage(
          'Invalid link',
          'This unsubscribe link is invalid or has been tampered with.',
          false,
        ),
      );
    return;
  }

  try {
    await prisma.guest.update({
      where: { id: guestId },
      data: { remindersUnsubscribed: true },
    });
  } catch (err: any) {
    // P2025 = record not found. Treat as already-unsubscribed so the user
    // sees a friendly result either way; everything else surfaces as an
    // unexpected error.
    if (err?.code !== 'P2025') {
      console.error('[reminder-unsubscribe] DB update failed:', err);
      res
        .status(500)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          renderUnsubscribePage(
            'Something went wrong',
            'We could not record your unsubscribe request. Please try again later.',
            false,
          ),
        );
      return;
    }
  }

  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(
      renderUnsubscribePage(
        'Unsubscribed',
        "You won't receive any more reminder emails for this event.",
        true,
      ),
    );
}

router.get('/reminders/unsubscribe', handleUnsubscribe);
router.post('/reminders/unsubscribe', handleUnsubscribe);

export default router;
