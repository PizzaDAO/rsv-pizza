import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { registerForMeeting } from '../services/zoom.service.js';

const router = Router();

async function requireUnderbossLike(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }
    if (await isAdmin(email)) return next();
    if (await isUnderboss(email)) return next();
    const gfx = await prisma.graphicsAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (gfx) return next();
    throw new AppError('Not authorized', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}

function getMeetingId(): string {
  const id = process.env.ZOOM_STREAM_MEETING_ID;
  if (!id) {
    throw new AppError('ZOOM_STREAM_MEETING_ID not configured', 500, 'CONFIG_ERROR');
  }
  return id;
}

interface CoHostEntry {
  email?: string;
  name?: string;
  canEdit?: boolean;
}

interface CollectedEmail {
  email: string; // lowercased, trimmed
  firstName: string;
  lastName?: string;
  displayName: string;
  partyId: string;
}

function splitName(name: string | null | undefined): { firstName: string; lastName?: string } {
  if (!name) return { firstName: 'Pizza', lastName: 'Host' };
  const trimmed = name.trim();
  if (!trimmed) return { firstName: 'Pizza', lastName: 'Host' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function collectApprovedEmails(): Promise<CollectedEmail[]> {
  const parties = await prisma.party.findMany({
    where: { underbossStatus: 'approved' },
    select: {
      id: true,
      user: { select: { email: true, name: true } },
      coHosts: true,
    },
  });

  const byEmail = new Map<string, CollectedEmail>();
  for (const p of parties) {
    const hostEmail = (p.user?.email || '').trim().toLowerCase();
    if (hostEmail) {
      const { firstName, lastName } = splitName(p.user?.name);
      if (!byEmail.has(hostEmail)) {
        byEmail.set(hostEmail, {
          email: hostEmail,
          firstName,
          lastName,
          displayName: p.user?.name || hostEmail,
          partyId: p.id,
        });
      }
    }

    const coHosts = (p.coHosts as CoHostEntry[] | null) || [];
    if (Array.isArray(coHosts)) {
      for (const h of coHosts) {
        const e = (h?.email || '').trim().toLowerCase();
        if (!e) continue;
        if (byEmail.has(e)) continue;
        const { firstName, lastName } = splitName(h?.name);
        byEmail.set(e, {
          email: e,
          firstName,
          lastName,
          displayName: h?.name || e,
          partyId: p.id,
        });
      }
    }
  }

  return Array.from(byEmail.values());
}

// Zoom rate limit is 10 req/sec on paid plans — cap concurrent registrations to 5.
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ item: T; result?: R; error?: Error }>> {
  const results: Array<{ item: T; result?: R; error?: Error }> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const result = await fn(item);
        results[idx] = { item, result };
      } catch (error) {
        results[idx] = { item, error: error as Error };
      }
    }
  }

  const workers = Array(Math.min(limit, items.length)).fill(0).map(worker);
  await Promise.all(workers);
  return results;
}

// POST /api/zoom-stream/sync — register approved hosts + co-hosts with Zoom
router.post('/sync', requireAuth, requireUnderbossLike, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dryRun = !!req.body?.dryRun;
    const meetingId = getMeetingId();

    const collected = await collectApprovedEmails();

    if (dryRun) {
      // Filter out already-registered for accurate "would register" count.
      const existing = await prisma.streamRegistrant.findMany({
        where: { zoomMeetingId: meetingId },
        select: { email: true },
      });
      const existingSet = new Set(existing.map(r => r.email.toLowerCase()));
      const wouldRegister = collected.filter(c => !existingSet.has(c.email));
      return res.json({
        dryRun: true,
        meetingId,
        totalUniqueEmails: collected.length,
        wouldRegister: wouldRegister.length,
        wouldSkip: collected.length - wouldRegister.length,
        sample: wouldRegister.slice(0, 25).map(c => ({ email: c.email, displayName: c.displayName })),
      });
    }

    // Find which emails are already in stream_registrants for this meeting.
    const existing = await prisma.streamRegistrant.findMany({
      where: { zoomMeetingId: meetingId },
      select: { email: true },
    });
    const existingSet = new Set(existing.map(r => r.email.toLowerCase()));

    const toRegister = collected.filter(c => !existingSet.has(c.email));

    const results = await runWithConcurrency(toRegister, 5, async (entry) => {
      const reg = await registerForMeeting({
        meetingId,
        email: entry.email,
        firstName: entry.firstName,
        lastName: entry.lastName,
      });

      await prisma.streamRegistrant.upsert({
        where: {
          email_zoomMeetingId: {
            email: entry.email,
            zoomMeetingId: meetingId,
          },
        },
        create: {
          email: entry.email,
          partyId: entry.partyId,
          zoomMeetingId: meetingId,
          zoomRegistrantId: reg.registrantId,
          zoomJoinUrl: reg.joinUrl,
          displayName: entry.displayName,
        },
        update: {
          zoomRegistrantId: reg.registrantId,
          zoomJoinUrl: reg.joinUrl,
          displayName: entry.displayName,
          partyId: entry.partyId,
        },
      });

      return reg;
    });

    const registered = results.filter(r => !r.error).length;
    const errors = results
      .filter(r => r.error)
      .map(r => ({ email: r.item.email, error: r.error!.message }));

    res.json({
      meetingId,
      totalUniqueEmails: collected.length,
      registered,
      skipped: existingSet.size,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

async function sendInviteEmail(
  email: string,
  displayName: string,
  joinUrl: string,
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const firstName = (displayName || '').split(/\s+/)[0] || 'there';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're on the Bitcoin Pizza Day broadcast</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 26px; margin: 0 0 10px 0;">You're on the Bitcoin Pizza Day broadcast</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">May 22, 2026 — 3:00 PM Eastern</p>
        </div>

        <p style="font-size: 16px; margin-bottom: 20px;">Hi ${firstName},</p>

        <p style="font-size: 16px; margin-bottom: 20px;">
          You're confirmed for the Global Pizza Party live broadcast on May 22, 2026 at 3:00 PM Eastern.
        </p>

        <p style="font-size: 16px; margin-bottom: 20px;">
          Your camera turns on automatically when you join — your party will appear in the broadcast gallery alongside parties from cities around the world. Your mic stays muted unless we cue you.
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${joinUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Join Bitcoin Pizza Day
          </a>
          <p style="margin-top: 12px; font-size: 13px; color: #888;">This link is unique to you and skips the waiting room.</p>
        </div>

        <div style="background: #fff4e6; padding: 20px; border-radius: 12px; margin: 30px 0;">
          <h3 style="margin: 0 0 10px 0; color: #ff6b35; font-size: 16px;">Tips:</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li>Point your camera at the party (people, pizza, the room).</li>
            <li>Mute background music if any.</li>
            <li>We'll DM you in Telegram if we want to bring you on mic.</li>
          </ul>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
          <p>See you on May 22.</p>
          <p style="margin-top: 12px;">— PizzaDAO</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [email],
      subject: 'Your party is on the Bitcoin Pizza Day global broadcast',
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }
}

// POST /api/zoom-stream/send-invites — Resend personalized join links to registrants
router.post('/send-invites', requireAuth, requireUnderbossLike, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dryRun = !!req.body?.dryRun;
    const force = !!req.body?.force;
    const meetingId = getMeetingId();

    const where = force
      ? { zoomMeetingId: meetingId, zoomJoinUrl: { not: null } }
      : { zoomMeetingId: meetingId, emailSentAt: null, zoomJoinUrl: { not: null } };

    const rows = await prisma.streamRegistrant.findMany({
      where,
      select: {
        id: true,
        email: true,
        displayName: true,
        zoomJoinUrl: true,
        emailSentAt: true,
      },
    });

    if (dryRun) {
      return res.json({
        dryRun: true,
        meetingId,
        wouldSend: rows.length,
        sample: rows.slice(0, 25).map(r => ({ email: r.email, displayName: r.displayName })),
      });
    }

    const results = await runWithConcurrency(rows, 5, async (row) => {
      await sendInviteEmail(row.email, row.displayName || row.email, row.zoomJoinUrl!);
      await prisma.streamRegistrant.update({
        where: { id: row.id },
        data: { emailSentAt: new Date() },
      });
    });

    const sent = results.filter(r => !r.error).length;
    const errors = results
      .filter(r => r.error)
      .map(r => ({ email: r.item.email, error: r.error!.message }));

    res.json({ meetingId, sent, errors });
  } catch (error) {
    next(error);
  }
});

// GET /api/zoom-stream/status — counts for the producer admin panel
router.get('/status', requireAuth, requireUnderbossLike, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meetingId = getMeetingId();

    const [collected, registrants, lastSent, lastCreated] = await Promise.all([
      collectApprovedEmails(),
      prisma.streamRegistrant.findMany({
        where: { zoomMeetingId: meetingId },
        select: { emailSentAt: true },
      }),
      prisma.streamRegistrant.findFirst({
        where: { zoomMeetingId: meetingId, emailSentAt: { not: null } },
        orderBy: { emailSentAt: 'desc' },
        select: { emailSentAt: true },
      }),
      prisma.streamRegistrant.findFirst({
        where: { zoomMeetingId: meetingId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const unsentCount = registrants.filter(r => !r.emailSentAt).length;

    res.json({
      meetingId,
      totalApprovedHostsAndCohosts: collected.length,
      registeredCount: registrants.length,
      unsentCount,
      lastSyncAt: lastCreated?.createdAt?.toISOString() ?? null,
      lastSendAt: lastSent?.emailSentAt?.toISOString() ?? null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
