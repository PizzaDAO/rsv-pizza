/**
 * stromboli-58523: Email notifications for party status + reimbursement-cap changes.
 *
 * Mirrors payoutEmailNotify's Resend path (RESEND_API_KEY, from `noreply@rsv.pizza`).
 * Fires whenever an admin/underboss approves or rejects a party, or changes its
 * reimbursement cap.
 *
 * Fire-and-forget: callers should NOT await these functions. Every failure mode
 * is caught internally so a Resend outage never blocks the underlying mutation.
 * Hosts without a `User.email` are silently skipped (also filters seed rows).
 */
import { prisma } from '../config/database.js';

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}

async function loadHostCtx(partyId: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      name: true,
      customUrl: true,
      inviteCode: true,
      user: { select: { email: true, name: true } },
    },
  });
  if (!party?.user?.email) return null; // no host email -> silent skip (also filters seed rows)
  const cityName =
    party.name.replace(/^Global Pizza Party\s+/i, '').trim() || party.name;
  const slug = party.customUrl ?? party.inviteCode;
  return {
    toEmail: party.user.email,
    hostName: party.user.name ?? 'there',
    cityName: esc(cityName),
    slug,
  };
}

async function sendResend(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  tag: string,
) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to,
      subject,
      html,
    }),
  }).catch((err) => console.warn(`[${tag}] Resend send failed:`, err?.message || err));
}

/** Fire-and-forget. Email host that an admin/UB approved or rejected their party. */
export async function emailHostOfStatusChange(
  partyId: string,
  newStatus: 'approved' | 'rejected',
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const ctx = await loadHostCtx(partyId);
    if (!ctx) return;
    const eventUrl = `https://rsv.pizza/host/${ctx.slug}`;
    let subject: string;
    let html: string;
    if (newStatus === 'approved') {
      subject = `🍕 Your Global Pizza Party in ${ctx.cityName} is approved!`;
      html = `<p>Hey ${esc(ctx.hostName)},</p>
<p>Great news — your event for <b>${ctx.cityName}</b> has been approved.</p>
<p>View and manage it on your <a href="${eventUrl}">event page</a>.</p>
<p>Best,<br>Dread Pizza Roberts<br>PizzaDAO</p>`;
    } else {
      subject = `Update on your Global Pizza Party in ${ctx.cityName}`;
      html = `<p>Hey ${esc(ctx.hostName)},</p>
<p>Your event for <b>${ctx.cityName}</b> wasn't approved. If you'd like to discuss or resubmit, reach out to your underboss.</p>
<p>Best,<br>Dread Pizza Roberts<br>PizzaDAO</p>`;
    }
    await sendResend(apiKey, ctx.toEmail, subject, html, 'emailHostOfStatusChange');
  } catch (err: any) {
    console.warn('[emailHostOfStatusChange] error:', err?.message || err);
  }
}

/** Fire-and-forget. Email host that their reimbursement cap changed. */
export async function emailHostOfCapChange(
  partyId: string,
  oldCapUsd: number | null,
  newCapUsd: number | null,
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const ctx = await loadHostCtx(partyId);
    if (!ctx) return;
    const paymentsUrl = `https://rsv.pizza/host/${ctx.slug}/payments`;
    const subject = `🍕 Reimbursement cap updated for ${ctx.cityName}`;
    let line: string;
    if (newCapUsd == null) {
      line = `Your reimbursement cap for <b>${ctx.cityName}</b> was cleared — it now uses the default.`;
    } else {
      const was =
        oldCapUsd != null ? ` (was $${Number(oldCapUsd).toFixed(2)})` : '';
      line = `Your reimbursement cap for <b>${ctx.cityName}</b> is now <b>$${Number(newCapUsd).toFixed(2)}</b>${was}.`;
    }
    const html = `<p>Hey ${esc(ctx.hostName)},</p>
<p>${line}</p>
<p>View details on your <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>Best,<br>Dread Pizza Roberts<br>PizzaDAO</p>`;
    await sendResend(apiKey, ctx.toEmail, subject, html, 'emailHostOfCapChange');
  } catch (err: any) {
    console.warn('[emailHostOfCapChange] error:', err?.message || err);
  }
}
