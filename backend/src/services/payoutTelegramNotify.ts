/**
 * boscaiola-49102: Molto Benny Telegram notifications for payout execution.
 *
 * Sends a Telegram DM via the Molto Benny bot (TELEGRAM_BOT_TOKEN) to the
 * linked host when their USDC payout reaches a terminal state
 * (`paid` or `failed`).
 *
 * Hosts opt in by linking their Telegram account via the bot's
 * `/start <token>` deeplink (see backend/src/routes/telegram-webhook.routes.ts).
 * When `parties.host_telegram_chat_id` is null, this helper silently no-ops.
 *
 * Fire-and-forget: callers should NOT await this function. We catch every
 * possible failure inside so a Telegram outage never blocks payout execution.
 *
 * Only `usdc_base` execute paths notify — Mercury card flows are intentionally
 * skipped (Mercury already emails the host their card details).
 */
import { prisma } from '../config/database.js';

const BOT_API = 'https://api.telegram.org';

export async function notifyHostOfPaymentExecution(
  payoutId: string,
  outcome: 'paid' | 'failed',
  details?: { txHash?: string; error?: string },
): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        party: {
          select: {
            name: true,
            customUrl: true,
            inviteCode: true,
            hostTelegramChatId: true,
          },
        },
      },
    });
    if (!payout) return;
    const chatId = payout.party.hostTelegramChatId;
    if (!chatId) return; // host hasn't linked Telegram — silent skip

    const amount = Number(payout.finalAmountUsd).toFixed(2);
    // Strip "Global Pizza Party " prefix for compactness
    const cityName =
      payout.party.name.replace(/^Global Pizza Party\s+/i, '').trim() ||
      payout.party.name;

    let text: string;
    if (outcome === 'paid') {
      const txLine = details?.txHash
        ? `\nTx: https://basescan.org/tx/${details.txHash}`
        : '';
      text = `🍕 *Pizza payment sent!*\n$${amount} USDC to your wallet for *${cityName}*.${txLine}`;
    } else {
      const errSuffix = details?.error
        ? `: ${details.error.slice(0, 200)}`
        : '';
      text = `⚠️ Your $${amount} payment for *${cityName}* couldn't go through${errSuffix}. Admin will retry shortly.`;
    }

    await fetch(`${BOT_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    }).catch((err) => {
      console.warn(
        '[notifyHostOfPaymentExecution] Telegram send failed:',
        err?.message || err,
      );
    });
  } catch (err: any) {
    // Never let a notification failure break the payout execution.
    console.warn(
      '[notifyHostOfPaymentExecution] error:',
      err?.message || err,
    );
  }
}
