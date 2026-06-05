import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { captureTelegramGroup } from '../services/telegramGroupCapture.js';

const router = Router();

const GROUP_TYPES = new Set(['group', 'supergroup']);

/**
 * Telegram webhook handler — receives inbound updates from the Telegram Bot API.
 *
 * Auth: secret-token header (set via `setWebhook` `secret_token` param). Telegram
 * sends `X-Telegram-Bot-Api-Secret-Token: <secret>` on every webhook call when
 * configured.
 *
 * Always returns 200 — Telegram retries non-2xx for up to 24h, which would flood
 * the route. We swallow errors and just log.
 *
 * Handles:
 *   - `/start <token>` in a private chat: looks up the party by
 *     `hostTelegramLinkToken`, stores `from.id` as `hostTelegramChatId`.
 *   - `/disconnect` in a private chat: nulls both columns on the party that has
 *     this chat_id.
 */

async function sendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err: any) {
    console.error('[Telegram Webhook] sendMessage failed:', err?.message || err);
  }
}

router.post('/', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    // Auth: secret-token header check
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const receivedSecret = req.header('X-Telegram-Bot-Api-Secret-Token');

    if (!expectedSecret) {
      console.error('[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET not configured — rejecting');
      // Telegram doesn't follow redirects on 403, but it does retry non-2xx.
      // Return 200 here too — we don't want flood retries while config is missing.
      return res.status(200).json({ ok: false, error: 'webhook secret not configured' });
    }

    if (receivedSecret !== expectedSecret) {
      console.warn('[Telegram Webhook] Secret mismatch — possible spoof');
      // Return 200 so Telegram doesn't retry (and so we don't leak whether the
      // route exists). A genuine Telegram call always carries the secret.
      return res.status(200).json({ ok: false });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('[Telegram Webhook] TELEGRAM_BOT_TOKEN not configured');
      return res.status(200).json({ ok: false });
    }

    const update = req.body || {};

    // ── tonda-58293 Phase 2: discrete group chat-id capture ───────────────
    // The bot learns a group's chat_id only from updates it receives. Capture
    // is intentionally limited to DISCRETE events (not every group message —
    // the bot sits in ~466+ groups with privacy mode OFF, so an upsert per
    // message is a needless write firehose; a group's chat_id is immutable
    // except on supergroup migration, which is auto-handled on send).
    //   - `my_chat_member` fires when the bot is added/promoted regardless of
    //     privacy mode → AUTOMATIC capture path for NEW groups.
    //   - `/register` (or `/register@<botusername>`) posted in a group →
    //     MANUAL capture path for groups the bot was already sitting in.
    // Both run BEFORE the private-DM logic below; group updates never reach
    // that path (it requires chat.type === 'private'). Non-command group
    // messages are ignored (no upsert) and just 200.

    // Automatic path: bot added/promoted to a group/supergroup.
    //
    // tonda-58293 FIX #2: `my_chat_member` also fires when the bot is REMOVED
    // (status 'left'/'kicked') or restricted. Capturing on those would keep a
    // group looking "connected" after the bot was kicked. Only capture when the
    // bot is an active member: status ∈ {member, administrator}, or 'restricted'
    // with is_member === true. On left/kicked → do nothing (just 200); we do NOT
    // delete the existing row ("safe auto-capture").
    try {
      const memberChat = update.my_chat_member?.chat;
      const newStatus: string | undefined = update.my_chat_member?.new_chat_member?.status;
      const isMember: boolean | undefined = update.my_chat_member?.new_chat_member?.is_member;
      const botIsActiveMember =
        newStatus === 'member' ||
        newStatus === 'administrator' ||
        (newStatus === 'restricted' && isMember === true);
      if (memberChat && GROUP_TYPES.has(memberChat.type) && typeof memberChat.id === 'number') {
        if (botIsActiveMember) {
          await captureTelegramGroup({
            chatId: memberChat.id,
            title: memberChat.title ?? null,
            chatType: memberChat.type,
          });
        }
        // Active-member → captured above. left/kicked/restricted-not-member →
        // intentionally a no-op. Either way this update is fully handled.
        return res.status(200).json({ ok: true });
      }
    } catch (captureErr: any) {
      console.error('[Telegram Webhook] my_chat_member capture failed:', captureErr?.message || captureErr);
      // Always 200, never block.
      return res.status(200).json({ ok: true });
    }

    // Manual path: `/register` command in a group/supergroup.
    {
      const msgChat = update.message?.chat;
      const msgText: string = typeof update.message?.text === 'string' ? update.message.text : '';
      if (msgChat && GROUP_TYPES.has(msgChat.type) && typeof msgChat.id === 'number') {
        // Only act on the /register command. Telegram delivers commands as
        // `/register` or `/register@BotUsername` (group disambiguation). Take
        // the first whitespace-delimited token, strip any `@mention` suffix,
        // and compare case-insensitively. Everything else in a group is ignored.
        const firstToken = msgText.trim().split(/\s+/)[0] || '';
        const command = firstToken.split('@')[0].toLowerCase();
        if (command === '/register') {
          try {
            const result = await captureTelegramGroup({
              chatId: msgChat.id,
              title: msgChat.title ?? null,
              chatType: msgChat.type,
            });
            const confirmation = result.matchedCityKey
              ? `✅ Captured this group for ${result.matchedCityKey} — reminders are now wired up.`
              : '✅ Got it — this group is captured. An admin can assign it to a city in /underboss.';
            await sendMessage(botToken, msgChat.id, confirmation);
          } catch (captureErr: any) {
            console.error('[Telegram Webhook] /register capture failed:', captureErr?.message || captureErr);
          }
        }
        // Group message handled (command or ignored non-command) — always 200,
        // never fall through to the private-DM path.
        return res.status(200).json({ ok: true });
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const message = update.message;
    if (!message) {
      // No message in this update (could be an edit, channel post, etc.) — ignore.
      return res.status(200).json({ ok: true });
    }

    const chat = message.chat;
    const from = message.from;
    const text: string = typeof message.text === 'string' ? message.text : '';

    // Only act on private 1:1 chats with a real user
    if (!chat || chat.type !== 'private' || !from || typeof from.id !== 'number') {
      return res.status(200).json({ ok: true });
    }

    const fromId: number = from.id;

    // Handle /start <token>
    if (text.startsWith('/start ')) {
      const token = text.slice(7).trim();
      if (!token) {
        await sendMessage(
          botToken,
          fromId,
          "This link is invalid or has expired. Ask your underboss for a fresh link.",
        );
        return res.status(200).json({ ok: true });
      }

      const party = await prisma.party.findUnique({
        where: { hostTelegramLinkToken: token },
        select: { id: true, name: true },
      });

      if (!party) {
        await sendMessage(
          botToken,
          fromId,
          "This link is invalid or has expired. Ask your underboss for a fresh link.",
        );
        return res.status(200).json({ ok: true });
      }

      await prisma.party.update({
        where: { id: party.id },
        data: { hostTelegramChatId: BigInt(fromId) },
      });

      await sendMessage(
        botToken,
        fromId,
        `Connected — you'll now receive PizzaDAO host announcements for ${party.name}. Send /disconnect anytime to unsubscribe.`,
      );

      return res.status(200).json({ ok: true });
    }

    // Handle /disconnect
    if (text.trim() === '/disconnect') {
      // Find any parties where this chat_id is the host's
      const parties = await prisma.party.findMany({
        where: { hostTelegramChatId: BigInt(fromId) },
        select: { id: true, name: true },
      });

      if (parties.length === 0) {
        await sendMessage(
          botToken,
          fromId,
          "You aren't currently connected. Nothing to disconnect.",
        );
        return res.status(200).json({ ok: true });
      }

      // Null both columns on each party
      await prisma.party.updateMany({
        where: { hostTelegramChatId: BigInt(fromId) },
        data: { hostTelegramChatId: null, hostTelegramLinkToken: null },
      });

      const cityList = parties.map((p) => p.name).join(', ');
      await sendMessage(
        botToken,
        fromId,
        `Disconnected from: ${cityList}. You'll no longer receive PizzaDAO host announcements.`,
      );

      return res.status(200).json({ ok: true });
    }

    // Help text for any other private message
    if (text.startsWith('/start') || text === '/help') {
      await sendMessage(
        botToken,
        fromId,
        "Hi — I'm the PizzaDAO host bot. Tap the unique link from your event details page to connect, or send /disconnect to unsubscribe.",
      );
      return res.status(200).json({ ok: true });
    }

    // Anything else — ignore silently (always 200)
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[Telegram Webhook] Unhandled error:', err?.message || err);
    // Always 200 — see header comment.
    return res.status(200).json({ ok: false });
  }
});

export default router;
