/**
 * basil-14648: tell the host their pizza order is confirmed / paid. Fire-and-forget: never
 * throws, so a Resend or Telegram outage cannot fail the webhook (which pizza-mcp would retry).
 * Email through Resend; Telegram DM if the host linked the bot on this party.
 */
import type { PizzaOrder } from '@prisma/client';
import { prisma } from '../config/database.js';
import { brand } from '../config/brand.js';
import { sendTelegramMessage } from './telegramSend.js';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildOrderNotice(row: Pick<PizzaOrder, 'shopName' | 'tier' | 'confirmedTotalCents' | 'readyAtText'>, paymentsUrl: string) {
  const total = row.confirmedTotalCents != null ? `$${(row.confirmedTotalCents / 100).toFixed(2)}` : null;
  if (row.tier === 'native') {
    return {
      subject: `Your pizza order at ${row.shopName} is paid`,
      text: `Your pizza order at ${row.shopName}${total ? ` (${total})` : ''} is paid. A reminder line is on your Receipts list (it has no receipt image and is not counted). Upload the real receipt as usual: ${paymentsUrl}`,
    };
  }
  return {
    subject: `${row.shopName} confirmed your pizza order`,
    text:
      `${row.shopName} confirmed your order${total ? ` for ${total}` : ''}${row.readyAtText ? `, ready ${row.readyAtText}` : ''}. ` +
      `Pay at pickup, then upload the receipt photo as usual: ${paymentsUrl}. A reminder line with the confirmed total is on your Receipts list; it is not counted as a receipt and you can remove it there.`,
  };
}

/** Wait for the notice at most this long: pizza-mcp gives the webhook 5 s in total. */
export const NOTIFY_BUDGET_MS = 3000;

export async function notifyHostOfOrder(row: PizzaOrder, budgetMs = NOTIFY_BUDGET_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendNotices(row),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendNotices(row: PizzaOrder): Promise<void> {
  try {
    const [user, party] = await Promise.all([
      prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } }),
      prisma.party.findUnique({
        where: { id: row.partyId },
        select: { customUrl: true, inviteCode: true, hostTelegramChatId: true, userId: true },
      }),
    ]);
    if (!party) return;
    const paymentsUrl = `${brand.url}/host/${party.customUrl ?? party.inviteCode}/payments`;
    const { subject, text } = buildOrderNotice(row, paymentsUrl);

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && user?.email) {
      await fetch('https://api.resend.com/emails', {
        signal: AbortSignal.timeout(NOTIFY_BUDGET_MS),
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: brand.fromEmail,
          to: [user.email],
          subject,
          html: `<p>${esc(text)}</p>`,
        }),
      }).catch(() => undefined);
    }
    // The bot link belongs to the party owner, so only DM when the placing host is that owner.
    if (party.hostTelegramChatId && party.hostTelegramChatId > 0n && party.userId === row.userId) {
      await sendTelegramMessage(String(party.hostTelegramChatId), text);
    }
  } catch (err) {
    console.error('pizza order notify failed', err instanceof Error ? err.message : err);
  }
}
