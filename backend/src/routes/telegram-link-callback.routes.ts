/**
 * provola-58505 (Step 3): host-link callback for moltobene.
 *
 *   POST /api/telegram/link-host
 *     Called by moltobene when a host taps a `?start=rsvp_<token>` deep-link in
 *     the bot. moltobene captures the host's Telegram chat_id and hands it back
 *     to us with the token so we can persist the host↔party link — the same
 *     effect as the legacy inbound-webhook `/start <token>` branch, but driven
 *     by moltobene now that it owns the bot's inbound updates.
 *
 *     Auth: header `x-api-key` must equal `TELEGRAM_LINK_CALLBACK_SECRET`.
 *       - env unset → 503 { ok:false, reason:'not configured' }
 *       - mismatch  → 401
 *     Body: { token: string, chatId: number|string }
 *     Look up the party by `hostTelegramLinkToken`; if none → 200
 *     { ok:false, reason:'invalid token' } (a missing/expired token is not an
 *     error, just a no-op); else set `hostTelegramChatId = BigInt(chatId)` and
 *     return { ok:true, partyName }.
 *
 * provola-58505: this is now the ONLY host-link path. The old inbound webhook
 * (`telegram-webhook.routes.ts`, with its `/start` branch) was retired — the
 * bot token is owned by moltobene, which handles `/start rsvp_<token>` and
 * calls back here.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

router.post('/link-host', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const secret = process.env.TELEGRAM_LINK_CALLBACK_SECRET;
    if (!secret) {
      return res.status(503).json({ ok: false, reason: 'not configured' });
    }
    const provided = req.header('x-api-key') || '';
    if (provided !== secret) {
      return res.status(401).json({ ok: false, reason: 'unauthorized' });
    }

    const { token, chatId } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, reason: 'token is required' });
    }

    // Always validate chatId is integer-like before BigInt() (which throws).
    if (chatId === undefined || chatId === null || `${chatId}`.trim() === '') {
      return res.status(400).json({ ok: false, reason: 'chatId is required' });
    }
    const chatIdStr = `${chatId}`.trim();
    if (!/^-?\d+$/.test(chatIdStr)) {
      return res.status(400).json({ ok: false, reason: 'chatId must be an integer' });
    }

    const party = await prisma.party.findUnique({
      where: { hostTelegramLinkToken: token },
      select: { id: true, name: true },
    });

    if (!party) {
      // Missing/expired token — not an error, just nothing to link.
      return res.status(200).json({ ok: false, reason: 'invalid token' });
    }

    await prisma.party.update({
      where: { id: party.id },
      data: { hostTelegramChatId: BigInt(chatIdStr) },
    });

    return res.status(200).json({ ok: true, partyName: party.name });
  } catch (err: any) {
    console.error('[provola-58505][link-host] error:', err?.message || err);
    return res.status(500).json({ ok: false, reason: 'internal error' });
  }
});

export default router;
