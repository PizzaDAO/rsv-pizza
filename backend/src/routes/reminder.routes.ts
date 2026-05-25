/**
 * margherita-58471: T-4h automated email reminders.
 *
 *   GET  /api/cron/event-reminders
 *     Vercel-cron entrypoint. Gated by `Authorization: Bearer ${CRON_SECRET}`.
 *     Scans for events with date BETWEEN NOW()+3h45m AND NOW()+4h15m and
 *     `reminders_enabled = TRUE`, atomically claims approved-and-emailable
 *     guests by setting `reminder_sent_at = NOW()` in a single UPDATE …
 *     RETURNING, then sends via React Email + Resend SDK with a small
 *     concurrency pool. On send failure, the claim is rolled back so the
 *     next 15-minute tick will retry.
 *
 *   GET / POST /api/reminders/unsubscribe?g=<guestId>&s=<sig>
 *     One-click List-Unsubscribe target. Verifies the per-guest HMAC,
 *     flips reminders_unsubscribed = TRUE, renders a small confirmation page.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { verifyGuestSig } from '../lib/unsubscribe.js';
import { sendReminder, type ReminderEventCtx } from '../lib/sendReminder.js';

const router = Router();

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

// ---------- GET /api/cron/event-reminders ----------

interface ReminderGuestRow {
  id: string;
  name: string;
  email: string;
  party_id: string;
}

router.get('/cron/event-reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not configured — reminder cron is a no-op');
      res.json({ ok: true, scanned: 0, sent: 0, failed: 0, note: 'RESEND_API_KEY missing' });
      return;
    }

    // Window: T-4h ± 15min. With a 15-minute cron cadence every approved
    // guest gets exactly one shot even if a tick is slightly late, and the
    // per-row reminder_sent_at claim dedupes overlap.
    const now = new Date();
    const windowStart = new Date(now.getTime() + (4 * 60 - 15) * 60 * 1000);
    const windowEnd = new Date(now.getTime() + (4 * 60 + 15) * 60 * 1000);

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

    // Atomic claim. Any guest whose row updates here is ours to send to.
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
      const ctx: ReminderEventCtx = {
        partyName: party.name,
        partyDate: party.date,
        partyTimezone: party.timezone,
        partyAddress: party.address,
        partyVenueName: party.venueName,
        partyImageUrl: party.eventImageUrl,
        inviteCode: party.inviteCode,
        customUrl: party.customUrl,
      };
      return sendReminder(guest, ctx, 4);
    });

    // Roll back claims for any send that failed so the next tick retries.
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
