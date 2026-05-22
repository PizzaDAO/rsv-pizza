/**
 * cipolla-49102: Email notifications for payout execution.
 *
 * Mirrors boscaiola-49102's Telegram notifier with an email path via Resend
 * (RESEND_API_KEY, from `noreply@rsv.pizza`). Unlike Telegram (USDC-only),
 * this fires for ALL three payout methods because email is the natural
 * channel for non-USDC methods:
 *   - `usdc_base`     → "$X USDC sent" + BaseScan link
 *   - `mercury_card`  → "$X Mercury card issued" + Mercury activation hint
 *   - `wire`          → "$X wire initiated" + receiving-bank setup note
 *   - any failed      → generic apology + retry note (admin will retry)
 *
 * Fire-and-forget: callers should NOT await this function. Every failure
 * mode is caught internally so a Resend outage never blocks payout execute.
 * Hosts without a `User.email` are silently skipped.
 */
import { prisma } from '../config/database.js';

export async function emailHostOfPaymentExecution(
  payoutId: string,
  outcome: 'paid' | 'failed',
  details?: { txHash?: string; error?: string },
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        party: { select: { name: true, customUrl: true, inviteCode: true } },
        host: { select: { email: true, name: true } },
      },
    });
    if (!payout) return;
    const toEmail = payout.host?.email;
    if (!toEmail) return; // host has no email — silent skip

    const amount = Number(payout.finalAmountUsd).toFixed(2);
    // Strip "Global Pizza Party " prefix for compactness
    const cityName =
      payout.party.name.replace(/^Global Pizza Party\s+/i, '').trim() ||
      payout.party.name;
    const method = payout.payoutMethod ?? 'unknown';
    const slug = payout.party.customUrl ?? payout.party.inviteCode;
    const paymentsUrl = `https://rsv.pizza/host/${slug}/payments`;
    const hostName = payout.host?.name ?? 'there';

    let subject: string;
    let html: string;
    if (outcome === 'paid') {
      if (method === 'usdc_base') {
        const txLink = details?.txHash
          ? `<p>View on Basescan: <a href="https://basescan.org/tx/${details.txHash}">${details.txHash.slice(0, 12)}…</a></p>`
          : '';
        subject = `🍕 $${amount} USDC sent for ${cityName}`;
        html = `<p>Hey ${hostName},</p>
<p>$${amount} USDC has been sent to your wallet for <b>${cityName}</b>.</p>
${txLink}
<p>You can view it on your <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>— Pizza DAO</p>`;
      } else if (method === 'mercury_card') {
        subject = `🍕 $${amount} Mercury card issued for ${cityName}`;
        html = `<p>Hey ${hostName},</p>
<p>A Mercury virtual debit card for <b>$${amount}</b> has been issued for <b>${cityName}</b>.</p>
<p>The card activation email comes directly from Mercury. If it doesn't reach you within a few hours, ping us — we may need to forward it manually.</p>
<p>View status on your <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>— Pizza DAO</p>`;
      } else if (method === 'wire') {
        subject = `🍕 $${amount} wire initiated for ${cityName}`;
        html = `<p>Hey ${hostName},</p>
<p>A $${amount} wire transfer for <b>${cityName}</b> has been initiated. Our bank will email you to complete the receiving-bank setup.</p>
<p>View status on your <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>— Pizza DAO</p>`;
      } else {
        subject = `🍕 $${amount} payment sent for ${cityName}`;
        html = `<p>Hey ${hostName},</p>
<p>$${amount} has been paid out for <b>${cityName}</b>.</p>
<p>View on your <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>— Pizza DAO</p>`;
      }
    } else {
      // failed
      const errorLine = details?.error
        ? `<p style="color:#888;font-size:12px;">Reason: ${details.error
            .slice(0, 300)
            .replace(/[<>&]/g, '')}</p>`
        : '';
      subject = `⚠️ $${amount} payment retry needed for ${cityName}`;
      html = `<p>Hey ${hostName},</p>
<p>Your <b>$${amount}</b> payment for <b>${cityName}</b> couldn't go through. Admin will retry shortly — no action needed from you.</p>
${errorLine}
<p>Status: <a href="${paymentsUrl}">Payments tab</a>.</p>
<p>— Pizza DAO</p>`;
    }

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RSV.Pizza <noreply@rsv.pizza>',
        to: toEmail,
        subject,
        html,
      }),
    }).catch((err) => {
      console.warn(
        '[emailHostOfPaymentExecution] Resend send failed:',
        err?.message || err,
      );
    });
  } catch (err: any) {
    // Never let a notification failure break the payout execution.
    console.warn('[emailHostOfPaymentExecution] error:', err?.message || err);
  }
}
