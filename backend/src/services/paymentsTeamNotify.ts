/**
 * argentina-92103: payments-team notifications for regional-underboss signals.
 *
 * Fire-and-forget Telegram + email notification when:
 *   - a regional underboss APPROVES a payout (admin doesn't fire — they're
 *     already on /payments)
 *   - anyone clicks "Flag ready for payment" on a row
 *
 * Both delivery channels silently no-op when their env vars are unset, so
 * this helper is safe to call even before `PAYMENTS_TEAM_TG_CHAT_ID` /
 * `PAYMENTS_TEAM_EMAILS` are configured on Vercel.
 *
 * Required env vars:
 *   - `TELEGRAM_BOT_TOKEN` + `PAYMENTS_TEAM_TG_CHAT_ID` for Telegram
 *   - `RESEND_API_KEY` + `PAYMENTS_TEAM_EMAILS` (csv) for email
 *
 * Caller pattern: `void notifyPaymentsTeam({ kind, payoutId })` — never await.
 * Every failure path is swallowed inside so a notification outage cannot
 * block an approve/flag action.
 */
import { prisma } from '../config/database.js';

type NotifyKind = 'approved' | 'flag_ready';

export async function notifyPaymentsTeam(opts: {
  kind: NotifyKind;
  payoutId: string;
}): Promise<void> {
  try {
    const payout = await prisma.payout.findUnique({
      where: { id: opts.payoutId },
      include: {
        party: { select: { name: true, country: true, region: true } },
        host: { select: { name: true, email: true } },
      },
    });
    if (!payout) return;

    const amount = Number(payout.finalAmountUsd).toFixed(2);
    const cityName = payout.party.name.replace(/^Global Pizza Party\s+/i, '').trim() || payout.party.name;
    const recipient = payout.host?.name ?? payout.host?.email ?? 'unknown';
    const verb =
      opts.kind === 'flag_ready'
        ? 'Flagged ready for payment'
        : 'Approved by underboss';
    const verbWithIcon =
      opts.kind === 'flag_ready'
        ? '🚩 Flagged ready for payment'
        : '✅ Approved by underboss';

    const baseUrl = process.env.FRONTEND_BASE_URL || 'https://rsv.pizza';
    const reviewUrl = `${baseUrl}/payments`;
    const text = `${verbWithIcon}\n*${cityName}* — $${amount} USDC to ${recipient}\n${reviewUrl}`;

    // Telegram — single shared chat id (group or DM). Skip if either env var
    // is missing.
    const tgChat = process.env.PAYMENTS_TEAM_TG_CHAT_ID;
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    if (tgChat && tgToken) {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChat,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      }).catch((e: any) => {
        console.warn('[notifyPaymentsTeam] telegram fail:', e?.message || e);
      });
    }

    // Email — csv list via Resend. Skip if RESEND_API_KEY is missing OR
    // no recipients are configured.
    const emails = (process.env.PAYMENTS_TEAM_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const resendKey = process.env.RESEND_API_KEY;
    if (emails.length > 0 && resendKey) {
      const subject = `${verbWithIcon}: ${cityName} $${amount}`;
      const html = `
        <p>${verb}</p>
        <p><b>${escapeHtml(cityName)}</b> — $${amount} USDC to ${escapeHtml(recipient)}</p>
        <p><a href="${reviewUrl}">Review on rsv.pizza</a></p>
      `.trim();
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'RSV.Pizza <noreply@rsv.pizza>',
          to: emails,
          subject,
          html,
        }),
      }).catch((e: any) => {
        console.warn('[notifyPaymentsTeam] resend fail:', e?.message || e);
      });
    }
  } catch (err: any) {
    console.warn('[notifyPaymentsTeam] error:', err?.message || err);
  }
}

/** Minimal HTML escape for interpolating user-provided names/cities. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
