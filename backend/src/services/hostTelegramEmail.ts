/**
 * guanciale-58491: Resend email paths for the "DM all GPP hosts" feature.
 *
 * Two fallbacks, both via Resend (RESEND_API_KEY, from `noreply@rsv.pizza`),
 * mirroring `payoutEmailNotify.ts`:
 *
 *   1. sendConnectInviteEmail  — for an UNLINKED host: email their personal
 *      `https://t.me/<bot>?start=<token>` deeplink so they can connect the bot.
 *   2. sendBroadcastFallbackEmail — for a SELECTED host who turned out not to
 *      be connected at send time: email the broadcast message text so they
 *      still receive the announcement.
 *
 * Both return a boolean (sent / not-sent) and never throw — a Resend outage
 * must not break the broadcast loop. Hosts without an email are skipped by the
 * caller (the caller already filters), but we double-check here too.
 *
 * NOTE: `withBennySignature` is intentionally NOT applied to email bodies — it
 * is a Telegram-only convention (see telegram.routes.ts).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'RSV.Pizza <noreply@rsv.pizza>';

/** Minimal HTML escape for user-authored text dropped into an email body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function resendSend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`[hostTelegramEmail] Resend ${resp.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[hostTelegramEmail] Resend send failed:', err?.message || err);
    return false;
  }
}

/**
 * Email an unlinked host the personal Telegram connect deeplink. Returns true
 * if the email was accepted by Resend.
 */
export async function sendConnectInviteEmail(params: {
  toEmail: string;
  hostName?: string | null;
  cityName?: string | null;
  deeplink: string;
}): Promise<boolean> {
  const { toEmail, hostName, cityName, deeplink } = params;
  if (!toEmail || !deeplink) return false;

  const greet = hostName ? escapeHtml(hostName) : 'there';
  const cityLine = cityName
    ? ` for <b>${escapeHtml(cityName)}</b>`
    : '';
  const subject = '🍕 Connect Telegram to get PizzaDAO host announcements';
  const html = `<p>Hey ${greet},</p>
<p>Connect your Telegram${cityLine} so PizzaDAO can send you host announcements and reminders directly via @MoltoBeneBot.</p>
<p><a href="${deeplink}">Tap here to connect on Telegram</a></p>
<p style="color:#888;font-size:12px;">If the button doesn't work, open this link in Telegram: ${escapeHtml(deeplink)}</p>
<p>— Pizza DAO</p>`;

  return resendSend(toEmail, subject, html);
}

/**
 * Email a not-connected host the broadcast message text (email-the-message
 * fallback). The message is the same text that connected hosts received over
 * Telegram (already token-substituted by the caller). Returns true if accepted.
 */
export async function sendBroadcastFallbackEmail(params: {
  toEmail: string;
  hostName?: string | null;
  cityName?: string | null;
  message: string;
}): Promise<boolean> {
  const { toEmail, hostName, cityName, message } = params;
  if (!toEmail || !message) return false;

  const greet = hostName ? escapeHtml(hostName) : 'there';
  const cityName2 = cityName ? escapeHtml(cityName) : '';
  const subject = cityName2
    ? `🍕 PizzaDAO host announcement — ${cityName2}`
    : '🍕 PizzaDAO host announcement';
  // Preserve the message's line breaks in HTML.
  const body = escapeHtml(message).replace(/\n/g, '<br>');
  const html = `<p>Hey ${greet},</p>
<p>${body}</p>
<p style="color:#888;font-size:12px;">You're getting this by email because your Telegram isn't connected to @MoltoBeneBot yet. Connect it to receive these directly on Telegram next time.</p>
<p>— Pizza DAO</p>`;

  return resendSend(toEmail, subject, html);
}
