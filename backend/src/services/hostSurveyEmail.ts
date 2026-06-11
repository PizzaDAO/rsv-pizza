// panzerotti-58527: per-party HOST survey send. This is the SHARED send path
// for both the manual /underboss send and the morning-after cron.
//
// - Recipients = PRIMARY host only (party.user.email). Co-hosts are out of scope.
// - Upserts the one host_survey_responses row for the party (unique party_id),
//   generating a token on first send and REUSING it on resend (manual re-send).
// - Mirrors buildSurveyEmail (guest survey) for the email body.
// - Never throws; returns a boolean (sent / not-sent). A Resend outage or a
//   missing host email must not break the send loop.

import crypto from 'crypto';
import { prisma } from '../config/database.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'RSV.Pizza <noreply@rsv.pizza>';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip the canonical "Global Pizza Party " prefix to get a clean city label.
function cityLabel(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '').trim() || name;
}

function buildHostSurveyEmail(
  party: { name: string; eventImageUrl?: string | null },
  hostName: string | null | undefined,
  token: string
): { subject: string; html: string } {
  const baseUrl = 'https://rsv.pizza';
  const surveyUrl = `${baseUrl}/host-survey/${token}`;

  const greeting = hostName ? escapeHtml(hostName.trim().split(/\s+/)[0]) : 'there';
  const city = cityLabel(party.name);

  const flyerBlock = party.eventImageUrl
    ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="${party.eventImageUrl}" alt="${escapeHtml(party.name)}" style="max-width: 100%; border-radius: 12px;" />
          </div>`
    : '';

  const subject = `How did hosting ${city} go? Tell us 🍕`;

  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>How did hosting go?</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${flyerBlock}
          <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
            <h2 style="color: #1a1a2e; margin-top: 0;">Thanks for hosting, ${greeting}!</h2>
            <p style="margin: 0; color: #333; font-size: 15px;">We'd love to hear how hosting <strong>${escapeHtml(city)}</strong> went. It takes less than a minute and helps us support hosts better next time.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${surveyUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">Take the host survey</a>
          </div>
          <p style="color: #555; font-size: 14px;">Best,<br>Dread Pizza Roberts<br>PizzaDAO</p>
        </body>
      </html>
    `;

  return { subject, html };
}

/**
 * Send (or resend) the host survey email for a single party. Returns true iff
 * the email was accepted by Resend. Skips silently (returns false) when there
 * is no primary-host email or RESEND_API_KEY is unset.
 */
export async function sendHostSurveyEmail(partyId: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  try {
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        id: true,
        name: true,
        customUrl: true,
        inviteCode: true,
        eventImageUrl: true,
        estimatedAttendance: true,
        userId: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (!party?.user?.email || !party.user.id) return false;

    // Upsert the response row (unique party_id). Reuse the existing token on
    // resend; generate one on first send.
    const existing = await prisma.hostSurveyResponse.findUnique({
      where: { partyId: party.id },
      select: { token: true },
    });
    const token = existing?.token ?? crypto.randomUUID();
    const now = new Date();

    await prisma.hostSurveyResponse.upsert({
      where: { partyId: party.id },
      create: {
        token,
        partyId: party.id,
        hostUserId: party.user.id,
        sentAt: now,
      },
      update: {
        sentAt: now,
        hostUserId: party.user.id,
        updatedAt: now,
      },
    });

    const { subject, html } = buildHostSurveyEmail(
      { name: party.name, eventImageUrl: party.eventImageUrl },
      party.user.name,
      token
    );

    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [party.user.email],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`[hostSurveyEmail] Resend ${resp.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[hostSurveyEmail] send failed:', err?.message || err);
    return false;
  }
}
