/**
 * White-label: tell the admins that an event created on a brand site (team1/monad/doge ...) is
 * waiting for approval. Brand events default to underbossStatus='pending' and stay off the public
 * listing until an admin approves them on the underboss/admin dashboard.
 *
 * Two audiences (plans/wl-self-serve-brands.md §2.1, Snax 2026-11-17):
 *  - the brand's own admins (`series_admins`, status active, alerts_enabled): emailed from the brand's
 *    site with a link to `<site>/brand-admin/events`. On by default; kill switch SERIES_ADMIN_ALERTS=off.
 *  - PizzaDAO: unchanged and OFF unless env BRAND_EVENT_ADMIN_ALERTS === 'on'. Recipients:
 *    `BRAND_EVENT_NOTIFY_EMAILS` (csv) when set, else every DB admin (role admin or super_admin; NOT
 *    payment_admin). PizzaDAO stops getting a brand's alerts while that brand has an active admin with alerts
 *    enabled (and the series-admin channel is on), so someone is always told.
 *
 * Uses the Resend path. No-ops without RESEND_API_KEY (so dev and tests never send), and never
 * throws: callers fire-and-forget it (`void ...`).
 */
import { prisma } from '../config/database.js';
import { brand } from '../config/brand.js';
import { brandedSiteForParty } from '../lib/siteBrand.js';
import { sendBrandedEmail } from '../lib/resendSend.js';

/** Max admin alert emails per creator per hour; extra brand events are still created, just not announced. */
export const ADMIN_ALERTS_PER_USER_PER_HOUR = 3;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

/** Where admins approve events (the underboss/admin dashboard lives on the main origin). */
export const approvalUrl = () => `${brand.url}/underboss`;

export function buildAdminNotifyEmail(opts: {
  eventName: string;
  brandName: string;
  hostLabel: string;
  eventUrl: string;
  adminUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `New ${opts.brandName} event pending approval: ${opts.eventName}`,
    html: `<p>A new event was created on <b>${esc(opts.brandName)}</b> and is waiting for approval.</p>
<p><b>${esc(opts.eventName)}</b><br>Host: ${esc(opts.hostLabel)}<br>Event page: <a href="${esc(opts.eventUrl)}">${esc(opts.eventUrl)}</a></p>
<p><a href="${esc(opts.adminUrl)}">Review and approve it on the admin dashboard</a></p>`,
  };
}

export async function resolveAdminRecipients(): Promise<string[]> {
  const override = (process.env.BRAND_EVENT_NOTIFY_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (override.length) return [...new Set(override)];
  const rows = await prisma.admin.findMany({
    where: { role: { in: ['admin', 'super_admin'] } },
    select: { email: true },
  });
  return [...new Set(rows.map((r: { email: string }) => r.email.toLowerCase()).filter(Boolean))];
}

/** Where a brand's own admins review events (on the brand's site; the page ships with the settings UI). */
export const seriesAdminEventsUrl = (siteUrl: string) => `${siteUrl}/brand-admin/events`;

/**
 * The series' active brand admins. `activeCount` counts every active admin; `recipients` are the ones
 * with alerts enabled (they decide whether PizzaDAO is still alerted).
 */
export async function resolveSeriesAdminRecipients(seriesId: string): Promise<{ activeCount: number; recipients: string[] }> {
  const rows = await prisma.seriesAdmin.findMany({
    where: { seriesId, status: 'active' },
    select: { email: true, alertsEnabled: true },
  });
  const recipients = [...new Set(
    rows.filter((r: { alertsEnabled: boolean }) => r.alertsEnabled).map((r: { email: string }) => r.email.toLowerCase()).filter(Boolean),
  )] as string[];
  return { activeCount: rows.length, recipients };
}

export async function notifyAdminsOfBrandEvent(partyId: string): Promise<void> {
  try {
    // PizzaDAO alerts ship disabled (BRAND_EVENT_ADMIN_ALERTS=on to opt in); brand-admin alerts are
    // on unless SERIES_ADMIN_ALERTS=off. With both off nothing is read or sent.
    const pizzadaoAlertsOn = process.env.BRAND_EVENT_ADMIN_ALERTS === 'on';
    const seriesAlertsOn = process.env.SERIES_ADMIN_ALERTS !== 'off';
    if (!pizzadaoAlertsOn && !seriesAlertsOn) return;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        name: true, customUrl: true, inviteCode: true, eventSeriesId: true, underbossStatus: true, userId: true,
        user: { select: { email: true, name: true } },
      },
    });
    if (!party || party.underbossStatus !== 'pending') return;
    const site = await brandedSiteForParty(party);
    if (!site) return; // only brand-site events
    // Spam guard: one account creating many brand events must not flood the admins' inboxes.
    // This event is already counted, so the Nth alert is the last one sent.
    const recent = await prisma.party.count({
      where: {
        userId: party.userId,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        eventSeries: { is: { siteUrl: { not: null } } },
      },
    });
    if (recent > ADMIN_ALERTS_PER_USER_PER_HOUR) return;
    const hostLabel = [party.user?.name, party.user?.email].filter(Boolean).join(' / ') || 'unknown';

    // Brand's own admins. A failed lookup must never swallow the PizzaDAO alert (fail toward telling someone).
    let seriesAdmins = { activeCount: 0, recipients: [] as string[] };
    if (seriesAlertsOn && party.eventSeriesId) {
      try {
        seriesAdmins = await resolveSeriesAdminRecipients(party.eventSeriesId);
      } catch (err: any) {
        console.warn('[notifyAdminsOfBrandEvent] series admin lookup failed:', err?.message || err);
      }
    }
    if (seriesAdmins.recipients.length) {
      const { subject, html } = buildAdminNotifyEmail({
        eventName: party.name,
        brandName: site.name,
        hostLabel,
        eventUrl: `${site.url}/${party.customUrl ?? party.inviteCode}`,
        adminUrl: seriesAdminEventsUrl(site.url),
      });
      // One message per admin so addresses aren't shared between recipients.
      for (const email of seriesAdmins.recipients) {
        try {
          await sendBrandedEmail({ site, apiKey, payload: { to: [email], subject, html } });
        } catch (err: any) {
          console.warn('[notifyAdminsOfBrandEvent] series admin send failed:', err?.message || err);
        }
      }
    }

    // PizzaDAO: skipped only when a brand admin was actually told, so someone always hears about the event.
    if (!pizzadaoAlertsOn || seriesAdmins.recipients.length > 0) return;
    const to = await resolveAdminRecipients();
    if (!to.length) return;
    const { subject, html } = buildAdminNotifyEmail({
      eventName: party.name,
      brandName: site.name,
      hostLabel,
      eventUrl: `${site.url}/${party.customUrl ?? party.inviteCode}`,
      adminUrl: approvalUrl(),
    });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: brand.fromEmail, to, subject, html }),
    }).catch((err) => console.warn('[notifyAdminsOfBrandEvent] Resend send failed:', err?.message || err));
  } catch (err: any) {
    console.warn('[notifyAdminsOfBrandEvent] error:', err?.message || err);
  }
}
