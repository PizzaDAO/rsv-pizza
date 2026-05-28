// romana-61204: Post-event guest survey routes.
//
// Three groups of endpoints live here (mounted in index.ts):
//   1. Public token-based  — GET/POST /api/survey/:token       (no auth)
//   2. Host/admin          — POST/GET /api/parties/:partyId/survey/*  (requireAuth)
//   3. Cron                — POST /api/cron/send-surveys         (CRON_SECRET)
//
// Each group is exported as its own Router so index.ts can path-scope them.
// We deliberately do NOT add any path-less router.use(middleware) at a shared
// /api/parties prefix (that would leak to every sibling /api/parties router).

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import {
  SURVEY_QUESTION_SET,
  SURVEY_QUESTION_SET_VERSION,
  validateSurveyAnswers,
} from '../lib/surveyQuestions.js';

const SURVEY_TAB = 'survey';

// ---------------------------------------------------------------------------
// Email helper — mirrors buildInviteEmail in routes/v1/guests.ts.
// ---------------------------------------------------------------------------
export function buildSurveyEmail(
  party: { name: string; eventImageUrl?: string | null },
  guest: { name: string; email: string },
  token: string
): { subject: string; html: string } {
  const baseUrl = 'https://rsv.pizza';
  const surveyUrl = `${baseUrl}/survey/${token}`;

  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const firstName = (guest.name || '').trim().split(/\s+/)[0] || 'there';

  const flyerBlock = party.eventImageUrl
    ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="${party.eventImageUrl}" alt="${escape(party.name)}" style="max-width: 100%; border-radius: 12px;" />
          </div>`
    : '';

  const subject = `How was ${party.name}? Tell us 🍕`;

  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>How was the event?</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${flyerBlock}
          <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
            <h2 style="color: #1a1a2e; margin-top: 0;">Thanks for coming, ${escape(firstName)}!</h2>
            <p style="margin: 0; color: #333; font-size: 15px;">We'd love to hear what you thought of <strong>${escape(party.name)}</strong>. It takes less than a minute and helps us throw better PizzaDAO events.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${surveyUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">Take the survey</a>
          </div>
        </body>
      </html>
    `;

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Shared send logic — generates tokens + emails CONFIRMED guests with an email.
// Reuses the bulk-invite batching pattern (groups of 10, 500ms delay, max 500).
// Returns { sent, failed, skipped } counts.
// ---------------------------------------------------------------------------
async function sendSurveyToParty(partyId: string): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, eventImageUrl: true },
  });
  if (!party) {
    throw new AppError('Party not found', 404, 'NOT_FOUND');
  }

  // Transactional email — RSVP'd-yes guests only (status CONFIRMED) with an
  // email. We intentionally ignore mailing_list_opt_in here.
  const guests = await prisma.guest.findMany({
    where: { partyId, status: 'CONFIRMED' },
    select: { id: true, name: true, email: true, surveyToken: true },
  });

  const resendApiKey = process.env.RESEND_API_KEY;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Cap at 500 like bulk-invite.
  const recipients = guests.filter((g) => !!g.email).slice(0, 500);
  skipped += guests.length - recipients.length;

  const BATCH_SIZE = 10;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (g) => {
        try {
          // Generate a survey token if the guest doesn't have one yet.
          let token = g.surveyToken;
          if (!token) {
            token = crypto.randomUUID();
            await prisma.guest.update({
              where: { id: g.id },
              data: { surveyToken: token },
            });
          }

          if (!resendApiKey) {
            // No email service configured — count as failed so the host knows.
            failed += 1;
            return;
          }

          const { subject, html } = buildSurveyEmail(
            { name: party.name, eventImageUrl: party.eventImageUrl },
            { name: g.name, email: g.email! },
            token
          );

          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: 'RSV.Pizza <noreply@rsv.pizza>',
              to: [g.email],
              subject,
              html,
            }),
          });

          if (!resp.ok) {
            failed += 1;
            return;
          }
          sent += 1;
        } catch {
          failed += 1;
        }
      })
    );

    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { sent, failed, skipped };
}

// ===========================================================================
// 1. PUBLIC token-based router — mounted at /api/survey
// ===========================================================================
const publicRouter = Router();

// GET /api/survey/:token — fetch the survey for a guest's tokenized link.
publicRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    const guest = await prisma.guest.findUnique({
      where: { surveyToken: token },
      select: {
        id: true,
        name: true,
        email: true,
        party: {
          select: { name: true, customUrl: true, inviteCode: true, surveyEnabled: true },
        },
        surveyResponse: {
          select: { answers: true, questionSetVersion: true },
        },
      },
    });

    if (!guest || !guest.party) {
      throw new AppError('Survey not found', 404, 'NOT_FOUND');
    }

    const firstName = (guest.name || '').trim().split(/\s+/)[0] || '';

    res.json({
      eventName: guest.party.name,
      eventSlug: guest.party.customUrl || guest.party.inviteCode,
      firstName,
      surveyEnabled: guest.party.surveyEnabled,
      questionSet: SURVEY_QUESTION_SET,
      questionSetVersion: SURVEY_QUESTION_SET_VERSION,
      alreadySubmitted: !!guest.surveyResponse,
      answers: guest.surveyResponse?.answers ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/survey/:token — submit (or resubmit) survey answers.
publicRouter.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    const guest = await prisma.guest.findUnique({
      where: { surveyToken: token },
      select: {
        id: true,
        email: true,
        partyId: true,
        party: { select: { surveyEnabled: true } },
      },
    });

    if (!guest || !guest.party) {
      throw new AppError('Survey not found', 404, 'NOT_FOUND');
    }

    if (!guest.party.surveyEnabled) {
      throw new AppError('This survey is no longer accepting responses', 403, 'SURVEY_DISABLED');
    }

    // Server-side validation against the canonical question set.
    const answers = validateSurveyAnswers((req.body as { answers?: unknown })?.answers);

    // Upsert keyed on guest_id (unique). Resubmit overwrites.
    await prisma.surveyResponse.upsert({
      where: { guestId: guest.id },
      create: {
        partyId: guest.partyId,
        guestId: guest.id,
        email: guest.email || '',
        questionSetVersion: SURVEY_QUESTION_SET_VERSION,
        answers,
      },
      update: {
        answers,
        questionSetVersion: SURVEY_QUESTION_SET_VERSION,
        updatedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// 2. HOST/ADMIN router — mounted at /api/parties (path-scoped, BEFORE partyRoutes)
//    Reuses the same host-auth middleware pattern as checklist.routes.ts:
//    requireAuth + canUserEditParty + canUserAccessTab.
// ===========================================================================
const hostRouter = Router();
hostRouter.use(requireAuth);

async function assertSurveyTabAccess(req: AuthRequest, partyId: string) {
  const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
  if (!canEdit) {
    throw new AppError('Party not found', 404, 'NOT_FOUND');
  }
  const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, SURVEY_TAB);
  if (!canAccessTab) {
    throw new AppError('You do not have access to the survey tab', 403, 'TAB_ACCESS_DENIED');
  }
}

// POST /api/parties/:partyId/survey/send — manual host send.
hostRouter.post('/:partyId/survey/send', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    await assertSurveyTabAccess(req, partyId);

    const result = await sendSurveyToParty(partyId);

    // Manual path may re-send even if survey_sent_at is already set.
    await prisma.party.update({
      where: { id: partyId },
      data: { surveySentAt: new Date() },
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/survey/results — aggregated results for the host.
hostRouter.get('/:partyId/survey/results', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    await assertSurveyTabAccess(req, partyId);

    const responses = await prisma.surveyResponse.findMany({
      where: { partyId },
      select: { answers: true },
    });

    const responseCount = responses.length;

    // Build aggregation scaffolding from the canonical question set.
    const ratings: Record<string, { sum: number; count: number; average: number | null }> = {};
    const yesno: Record<string, { yes: number; no: number }> = {};
    const multiple: Record<string, Record<string, number>> = {};
    const comments: Record<string, string[]> = {};

    for (const q of SURVEY_QUESTION_SET) {
      if (q.type === 'rating') ratings[q.id] = { sum: 0, count: 0, average: null };
      else if (q.type === 'yesno') yesno[q.id] = { yes: 0, no: 0 };
      else if (q.type === 'multiple') {
        multiple[q.id] = {};
        for (const opt of q.options ?? []) multiple[q.id][opt] = 0;
      } else if (q.type === 'text') comments[q.id] = [];
    }

    for (const r of responses) {
      const a = (r.answers ?? {}) as Record<string, unknown>;
      for (const q of SURVEY_QUESTION_SET) {
        const v = a[q.id];
        if (v === undefined || v === null) continue;
        if (q.type === 'rating' && typeof v === 'number') {
          ratings[q.id].sum += v;
          ratings[q.id].count += 1;
        } else if (q.type === 'yesno' && typeof v === 'boolean') {
          if (v) yesno[q.id].yes += 1;
          else yesno[q.id].no += 1;
        } else if (q.type === 'multiple') {
          const picks = Array.isArray(v) ? v : [v];
          for (const p of picks) {
            if (typeof p === 'string' && p in multiple[q.id]) {
              multiple[q.id][p] += 1;
            }
          }
        } else if (q.type === 'text' && typeof v === 'string' && v.trim()) {
          comments[q.id].push(v.trim());
        }
      }
    }

    for (const id of Object.keys(ratings)) {
      ratings[id].average =
        ratings[id].count > 0
          ? Math.round((ratings[id].sum / ratings[id].count) * 100) / 100
          : null;
    }

    res.json({
      responseCount,
      questionSet: SURVEY_QUESTION_SET,
      questionSetVersion: SURVEY_QUESTION_SET_VERSION,
      ratings,
      yesno,
      multiple,
      comments,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// 3. CRON router — mounted at /api/cron
//    POST /api/cron/send-surveys — guarded by CRON_SECRET.
//    Runs hourly; self-filters by event timezone (local 09:00 morning-after).
// ===========================================================================
const cronRouter = Router();

cronRouter.post('/send-surveys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Candidate parties: survey enabled, not yet sent, with an end time within
    // the last 7 days. We compute the timezone gate in JS below.
    const candidates = await prisma.party.findMany({
      where: {
        surveyEnabled: true,
        surveySentAt: null,
        endTime: { not: null, gte: sevenDaysAgo, lte: now },
      },
      select: { id: true, endTime: true, timezone: true },
    });

    const results: Array<{ partyId: string; sent: number; failed: number; skipped: number }> = [];

    for (const party of candidates) {
      if (!party.endTime) continue;
      if (!isMorningAfterInTimezone(party.endTime, now, party.timezone)) continue;

      try {
        const r = await sendSurveyToParty(party.id);
        await prisma.party.update({
          where: { id: party.id },
          data: { surveySentAt: new Date() },
        });
        results.push({ partyId: party.id, ...r });
      } catch {
        // Skip parties that error; the next hourly run will retry.
      }
    }

    res.json({ processed: results.length, results });
  } catch (error) {
    next(error);
  }
});

/**
 * Returns true if, in the event's own timezone, "now" is at or past 09:00 on
 * the calendar day AFTER the event's end. Events with no timezone fall back to
 * UTC. Uses Intl.DateTimeFormat (no tz library in the repo).
 */
export function isMorningAfterInTimezone(
  endTime: Date,
  now: Date,
  timezone: string | null
): boolean {
  const tz = timezone || 'UTC';
  try {
    const endParts = getTzParts(endTime, tz);
    const nowParts = getTzParts(now, tz);

    // The day-after calendar date in the event timezone.
    const endDateUtc = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
    const dayAfterUtc = endDateUtc + 24 * 60 * 60 * 1000;
    const dayAfter = new Date(dayAfterUtc);

    const target = {
      year: dayAfter.getUTCFullYear(),
      month: dayAfter.getUTCMonth() + 1,
      day: dayAfter.getUTCDate(),
    };

    // Compare (now's local date+hour) against (day-after date, 09:00).
    const nowKey =
      nowParts.year * 1_000_000_00 +
      nowParts.month * 1_000_000 +
      nowParts.day * 10_000 +
      nowParts.hour * 100 +
      nowParts.minute;
    const targetKey =
      target.year * 1_000_000_00 +
      target.month * 1_000_000 +
      target.day * 10_000 +
      9 * 100 +
      0;

    return nowKey >= targetKey;
  } catch {
    // Invalid timezone string — treat as UTC fallback by retrying with UTC.
    if (tz !== 'UTC') return isMorningAfterInTimezone(endTime, now, 'UTC');
    return false;
  }
}

function getTzParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  // Intl can emit "24" for midnight under hour12:false in some engines.
  if (hour === 24) hour = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
  };
}

export { publicRouter as surveyPublicRouter, hostRouter as surveyHostRouter, cronRouter as cronRouter };
