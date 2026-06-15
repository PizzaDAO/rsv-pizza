/**
 * provola-58505 (Step 3): host-link callback for moltobene.
 *
 *   POST /api/telegram/link-host
 *     Called by moltobene when someone taps a deep-link in the bot. moltobene
 *     captures the tapper's Telegram chat_id (+ @handle) and hands it back to us
 *     with the token so we can persist the link — the same effect as the legacy
 *     inbound-webhook `/start <token>` branch, but driven by moltobene now that
 *     it owns the bot's inbound updates.
 *
 *     Auth: header `x-api-key` must equal `TELEGRAM_LINK_CALLBACK_SECRET`.
 *       - env unset → 503 { ok:false, reason:'not configured' }
 *       - mismatch  → 401
 *     Body: { token: string, chatId: number|string,
 *             username?: string, telegramUserId?: number|string,
 *             purpose?: 'announce'|'submit' }   (purpose defaults to 'announce')
 *
 * suppli-58533: per-type authorization. Tapping a publicly-broadcast group
 * `submit_<token>` link no longer blindly overwrites the party's host link.
 * We now verify the tapper's @handle against the party host's `User.telegram`:
 *   - isHost  → set `hostTelegramChatId` (as before)            → role 'host'
 *   - submit  → register a photo-only contributor row           → role 'contributor'
 *   - announce (default, non-host) → do NOTHING (no host link)  → role 'unverified'
 * This closes the group-token hijack/overwrite AND the `rsvp_` replay bypass:
 * `hostTelegramChatId` is NEVER set unless the handle matches the host.
 *
 * provola-58505: this is now the ONLY host-link path. The old inbound webhook
 * (`telegram-webhook.routes.ts`, with its `/start` branch) was retired — the
 * bot token is owned by moltobene, which handles `/start rsvp_<token>` and
 * calls back here.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * Normalize a Telegram handle for case-insensitive equality:
 * lowercase, trim, strip a leading `@`, strip a leading `t.me/` /
 * `https://t.me/` (and any trailing slash). Returns '' if falsy.
 */
export function normalizeTgHandle(s: unknown): string {
  if (!s || typeof s !== 'string') return '';
  let h = s.trim().toLowerCase();
  // Strip URL forms: https://t.me/foo, http://t.me/foo, t.me/foo
  h = h.replace(/^https?:\/\//, '');
  h = h.replace(/^t\.me\//, '');
  // Strip a leading @ and any trailing slash(es).
  h = h.replace(/^@+/, '').replace(/\/+$/, '');
  return h.trim();
}

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

    const { token, chatId, username, telegramUserId, purpose } = (req.body || {}) as {
      token?: string;
      chatId?: number | string;
      username?: string;
      telegramUserId?: number | string;
      purpose?: 'announce' | 'submit';
    };

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

    // Default purpose to 'announce' (the legacy `rsvp_<token>` host deep-link).
    const linkPurpose: 'announce' | 'submit' = purpose === 'submit' ? 'submit' : 'announce';

    const party = await prisma.party.findUnique({
      where: { hostTelegramLinkToken: token },
      select: { id: true, name: true, coHosts: true, user: { select: { telegram: true } } },
    });

    if (!party) {
      // Missing/expired token — not an error, just nothing to link.
      return res.status(200).json({ ok: false, reason: 'invalid token' });
    }

    // suppli-58533 (crostata-58533): verify the tapper is the party host OR an
    // editor co-host before linking. Co-hosts live in parties.co_hosts (JSON);
    // only entries with canEdit===true count, and only their `telegram` field is
    // matched (never twitter/instagram — display-only partners have canEdit:false
    // and no telegram, so they're excluded).
    const tapperHandle = typeof username === 'string' ? username : null;
    const authorizedHandles: string[] = [];
    if (party.user?.telegram) authorizedHandles.push(party.user.telegram);
    const coHosts = Array.isArray(party.coHosts) ? (party.coHosts as unknown[]) : [];
    for (const ch of coHosts) {
      if (
        ch &&
        typeof ch === 'object' &&
        (ch as Record<string, unknown>).canEdit === true &&
        typeof (ch as Record<string, unknown>).telegram === 'string'
      ) {
        authorizedHandles.push((ch as Record<string, unknown>).telegram as string);
      }
    }
    const normalizedTapper = normalizeTgHandle(tapperHandle);
    const isHost =
      normalizedTapper !== '' &&
      authorizedHandles.some((h) => normalizeTgHandle(h) === normalizedTapper);

    // panettone-58533: parse telegramUserId once so BOTH the host and
    // contributor branches can persist it.
    const tgUserId =
      telegramUserId !== undefined &&
      telegramUserId !== null &&
      /^-?\d+$/.test(`${telegramUserId}`.trim())
        ? BigInt(`${telegramUserId}`.trim())
        : null;

    if (isHost) {
      // panettone-58533: multi-host. Record this chat in party_telegram_hosts
      // (the auth source for inbound submissions) so multiple co-hosts can each
      // submit. Keep host_telegram_chat_id as the single primary OUTBOUND DM
      // target (last verified host wins that slot).
      await prisma.partyTelegramHost.upsert({
        where: { partyId_chatId: { partyId: party.id, chatId: BigInt(chatIdStr) } },
        create: {
          partyId: party.id,
          chatId: BigInt(chatIdStr),
          telegramUserId: tgUserId,
          username: tapperHandle,
        },
        update: { username: tapperHandle, telegramUserId: tgUserId, updatedAt: new Date() },
      });
      await prisma.party.update({
        where: { id: party.id },
        data: { hostTelegramChatId: BigInt(chatIdStr) },
      });
      // Clear any stale photo-only contributor row so it can't shadow this host.
      await prisma.partyTelegramContributor.deleteMany({
        where: { partyId: party.id, chatId: BigInt(chatIdStr) },
      });
      return res.status(200).json({ ok: true, role: 'host', partyName: party.name });
    }

    // Not the host (or missing username / host has no handle on file).
    // CRITICAL: never set host_telegram_chat_id here — that was the hijack.
    if (linkPurpose === 'submit') {
      // Photo-only contributor: register them so host-inbound can route their
      // photos to this party's gallery (pending review). Reuses the hoisted
      // `tgUserId` parsed above (panettone-58533).
      await prisma.partyTelegramContributor.upsert({
        where: { partyId_chatId: { partyId: party.id, chatId: BigInt(chatIdStr) } },
        create: {
          partyId: party.id,
          chatId: BigInt(chatIdStr),
          telegramUserId: tgUserId,
          username: tapperHandle,
        },
        update: {
          username: tapperHandle,
          telegramUserId: tgUserId,
          updatedAt: new Date(),
        },
      });
      return res.status(200).json({ ok: true, role: 'contributor', partyName: party.name });
    }

    // purpose === 'announce' and not the host → do NOT link, do NOT contribute.
    return res.status(200).json({
      ok: false,
      role: 'unverified',
      reason: 'not_host',
      partyName: party.name,
    });
  } catch (err: any) {
    console.error('[provola-58505][link-host] error:', err?.message || err);
    return res.status(500).json({ ok: false, reason: 'internal error' });
  }
});

export default router;
