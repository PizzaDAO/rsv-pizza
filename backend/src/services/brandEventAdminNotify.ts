/**
 * White-label: tell the admins that an event created on a brand site (team1/monad/doge ...) is
 * waiting for approval. Brand events default to underbossStatus='pending' and stay off the public
 * listing until an admin approves them on the underboss/admin dashboard.
 *
 * Recipients: `BRAND_EVENT_NOTIFY_EMAILS` (csv) when set, else every DB admin (role admin or
 * super_admin; NOT payment_admin). Uses the existing Resend path. No-ops without RESEND_API_KEY
 * (so dev and tests never send), and never throws: callers fire-and-forget it (`void ...`).
 */
import { prisma } from '../config/database.js';
import { brand } from '../config/brand.js';
import { brandedSiteForParty } from '../lib/siteBrand.js';

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
<p><b>${esc(opts.eventName)}</b><br>Host: ${esc(opts.hostLabel)}<br>Event page: <a href="${opts.eventUrl}">${opts.eventUrl}</a></p>
<p><a href="${opts.adminUrl}">Review and approve it on the admin dashboard</a></p>`,
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

export async function notifyAdminsOfBrandEvent(partyId: string): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        name: true, customUrl: true, inviteCode: true, eventSeriesId: true, underbossStatus: true,
        user: { select: { email: true, name: true } },
      },
    });
    if (!party || party.underbossStatus !== 'pending') return;
    const site = await brandedSiteForParty(party);
    if (!site) return; // only brand-site events
    const to = await resolveAdminRecipients();
    if (!to.length) return;
    const hostLabel = [party.user?.name, party.user?.email].filter(Boolean).join(' / ') || 'unknown';
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
