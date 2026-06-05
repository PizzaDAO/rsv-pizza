import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireUnderbossAuth, UnderbossAuthRequest } from '../middleware/underbossAuth.js';
import { AppError } from '../middleware/error.js';
import { withBennySignature } from '../lib/bennySignature.js';
import { isValidAppTab } from '../lib/broadcastApps.js';

// Alias to keep the routes that were ported in from master readable.
type UnderbossRequest = UnderbossAuthRequest;

const router = Router();

/** Public event page URL for a party. Mirrors nft.routes.ts:80. */
function publicEventLink(party: { customUrl?: string | null; inviteCode?: string | null } | null | undefined): string {
  if (!party) return '';
  const slug = party.customUrl || party.inviteCode;
  return slug ? `https://rsv.pizza/${slug}` : '';
}

/** Host app deep-link for a party + chosen app tab. */
function appDeepLink(
  party: { inviteCode?: string | null } | null | undefined,
  appTab: string | null | undefined
): string {
  if (!party || !party.inviteCode || !appTab) return '';
  return `https://rsv.pizza/host/${party.inviteCode}/${appTab}`;
}

/**
 * Substitute the per-recipient {link} and {appLink} tokens. Always strips any
 * remaining {link}/{appLink} occurrences so an unresolved token (unlinked
 * group, missing slug, no app chosen) never ships as a literal to a group.
 */
function substituteLinkTokens(message: string, linkUrl: string, appLinkUrl: string): string {
  let out = message;
  out = out.replace(/\{link\}/g, linkUrl || '');
  out = out.replace(/\{appLink\}/g, appLinkUrl || '');
  return out;
}

/** Shape returned by GET /groups + consumed by the broadcast UI. */
type TelegramGroupRow = {
  id: string;
  chatId: string;
  chatUrl: string;
  city: string;
  country: string;
  region: string;
  underboss: string;
  partyId: string | null;
  partyLinked: boolean;
};

/**
 * Check whether a broadcast group is within the UB's city scope.
 *
 * Admins/graphics-admins (sentinel `__admin__` in regions) → always allowed.
 * Region-scoped UBs → allowed (region->city mapping lives in the GPP sheet,
 *   not in the backend; matches existing latitude in city-statuses endpoint).
 * City-scoped UBs → only their explicit cities (case-insensitive trim match).
 */
function groupInBroadcastScope(
  group: { city?: string },
  underboss: { regions: string[]; cities: string[] }
): boolean {
  if (underboss.regions.includes('__admin__')) return true;
  // If the UB has at least one region but no cities, we allow all groups —
  // the city→region mapping is sheet-side and not available here. This
  // mirrors the pragmatic v1 scope reduction noted on city-statuses.
  if (underboss.regions.length > 0 && (underboss.cities?.length ?? 0) === 0) return true;
  // City-scoped path
  const allowed = (underboss.cities || []).map((c) => c.toLowerCase().trim());
  const groupCity = (group.city || '').toLowerCase().trim();
  if (!groupCity) return false;
  return allowed.includes(groupCity);
}

/** Serialize a DB row to the API shape. */
function serializeGroup(g: {
  id: string;
  chatId: bigint;
  chatUrl: string | null;
  city: string;
  country: string;
  region: string | null;
  underboss: string | null;
  partyId: string | null;
}): TelegramGroupRow {
  return {
    id: g.id,
    chatId: g.chatId.toString(),
    chatUrl: g.chatUrl || '',
    city: g.city,
    country: g.country,
    region: g.region || '',
    underboss: g.underboss || '',
    partyId: g.partyId,
    partyLinked: g.partyId !== null,
  };
}

// GET /groups — DB-backed list of city Telegram groups, UB-scoped.
// Replaces the Google-Sheet fetch the frontend previously used.
router.get('/groups', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const rows = await prisma.cityTelegramGroup.findMany({
      orderBy: [{ city: 'asc' }],
      select: {
        id: true,
        chatId: true,
        chatUrl: true,
        city: true,
        country: true,
        region: true,
        underboss: true,
        partyId: true,
      },
    });
    // Scope against the denormalized city/region on each row (works even when
    // partyId is null). Admins/graphics-admins see all.
    const scoped = rows.filter((g) =>
      groupInBroadcastScope(g, { regions: ub.regions, cities: ub.cities || [] })
    );
    res.json({ groups: scoped.map(serializeGroup) });
  } catch (error) {
    next(error);
  }
});

// POST /groups — create a city Telegram group (admin/UB-scoped).
router.post('/groups', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const { chatId, chatUrl, city, country, region, underboss, partyId } = req.body || {};

    if (chatId === undefined || chatId === null || `${chatId}`.trim() === '') {
      throw new AppError('chatId is required', 400, 'VALIDATION_ERROR');
    }
    const chatIdStr = String(chatId).replace('#', '').trim();
    if (!/^-?\d+$/.test(chatIdStr)) {
      throw new AppError('chatId must be a numeric Telegram chat_id', 400, 'VALIDATION_ERROR');
    }
    if (!city || typeof city !== 'string' || !city.trim()) {
      throw new AppError('city is required', 400, 'VALIDATION_ERROR');
    }
    if (!country || typeof country !== 'string' || !country.trim()) {
      throw new AppError('country is required', 400, 'VALIDATION_ERROR');
    }

    // Scope check: the new row must be within the caller's scope.
    if (!groupInBroadcastScope({ city }, { regions: ub.regions, cities: ub.cities || [] })) {
      throw new AppError('City is outside your assigned scope', 403, 'FORBIDDEN');
    }

    // Optional party link must reference a real party.
    let linkedPartyId: string | null = null;
    if (partyId) {
      if (typeof partyId !== 'string') {
        throw new AppError('partyId must be a string', 400, 'VALIDATION_ERROR');
      }
      const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
      if (!party) throw new AppError('Linked party not found', 404, 'NOT_FOUND');
      linkedPartyId = party.id;
    }

    const created = await prisma.cityTelegramGroup.create({
      data: {
        chatId: BigInt(chatIdStr),
        chatUrl: chatUrl ? String(chatUrl) : null,
        city: city.trim(),
        country: country.trim(),
        region: region ? String(region) : null,
        underboss: underboss ? String(underboss) : null,
        partyId: linkedPartyId,
        createdBy: ub.email,
        updatedBy: ub.email,
      },
      select: {
        id: true, chatId: true, chatUrl: true, city: true,
        country: true, region: true, underboss: true, partyId: true,
      },
    });
    res.status(201).json({ group: serializeGroup(created) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('A group with this chatId already exists', 409, 'DUPLICATE'));
    }
    next(error);
  }
});

// PATCH /groups/:id — update a group (incl. link/unlink partyId), UB-scoped.
router.patch('/groups/:id', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const { id } = req.params;
    const existing = await prisma.cityTelegramGroup.findUnique({
      where: { id },
      select: { id: true, city: true, region: true },
    });
    if (!existing) throw new AppError('Group not found', 404, 'NOT_FOUND');
    if (!groupInBroadcastScope(existing, { regions: ub.regions, cities: ub.cities || [] })) {
      throw new AppError('Group is outside your assigned scope', 403, 'FORBIDDEN');
    }

    const { chatId, chatUrl, city, country, region, underboss, partyId } = req.body || {};
    const data: any = { updatedBy: ub.email };

    if (chatId !== undefined) {
      const chatIdStr = String(chatId).replace('#', '').trim();
      if (!/^-?\d+$/.test(chatIdStr)) {
        throw new AppError('chatId must be a numeric Telegram chat_id', 400, 'VALIDATION_ERROR');
      }
      data.chatId = BigInt(chatIdStr);
    }
    if (chatUrl !== undefined) data.chatUrl = chatUrl ? String(chatUrl) : null;
    if (city !== undefined) {
      if (!city || !String(city).trim()) throw new AppError('city cannot be empty', 400, 'VALIDATION_ERROR');
      data.city = String(city).trim();
    }
    if (country !== undefined) {
      if (!country || !String(country).trim()) throw new AppError('country cannot be empty', 400, 'VALIDATION_ERROR');
      data.country = String(country).trim();
    }
    if (region !== undefined) data.region = region ? String(region) : null;
    if (underboss !== undefined) data.underboss = underboss ? String(underboss) : null;
    if (partyId !== undefined) {
      if (partyId === null || partyId === '') {
        data.partyId = null; // unlink
      } else {
        if (typeof partyId !== 'string') throw new AppError('partyId must be a string', 400, 'VALIDATION_ERROR');
        const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
        if (!party) throw new AppError('Linked party not found', 404, 'NOT_FOUND');
        data.partyId = party.id;
      }
    }

    const updated = await prisma.cityTelegramGroup.update({
      where: { id },
      data,
      select: {
        id: true, chatId: true, chatUrl: true, city: true,
        country: true, region: true, underboss: true, partyId: true,
      },
    });
    res.json({ group: serializeGroup(updated) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return next(new AppError('A group with this chatId already exists', 409, 'DUPLICATE'));
    }
    next(error);
  }
});

// DELETE /groups/:id — remove a group, UB-scoped.
router.delete('/groups/:id', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const { id } = req.params;
    const existing = await prisma.cityTelegramGroup.findUnique({
      where: { id },
      select: { id: true, city: true, region: true },
    });
    if (!existing) throw new AppError('Group not found', 404, 'NOT_FOUND');
    if (!groupInBroadcastScope(existing, { regions: ub.regions, cities: ub.cities || [] })) {
      throw new AppError('Group is outside your assigned scope', 403, 'FORBIDDEN');
    }
    await prisma.cityTelegramGroup.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /broadcast — Send message to multiple Telegram groups
router.post('/broadcast', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const { groups, message, parseMode, appTab } = req.body;

    // Validate groups
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new AppError('groups must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (groups.length > 500) {
      throw new AppError('Maximum 500 groups per request', 400, 'VALIDATION_ERROR');
    }

    // Validate message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required', 400, 'VALIDATION_ERROR');
    }
    if (message.length > 4096) {
      throw new AppError('message must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    // calzone-58481: optional {appLink} target. The URL segment is the app's
    // `tab` value; validate against the server-side catalog so a bogus tab can
    // never produce a deep-link. Empty/absent = no app chosen.
    const validatedAppTab: string | null =
      appTab === undefined || appTab === null || appTab === ''
        ? null
        : isValidAppTab(appTab)
          ? appTab
          : (() => { throw new AppError('appTab is not a recognized app', 400, 'VALIDATION_ERROR'); })();

    // Validate parseMode
    const validParseModes = ['HTML', 'Markdown', 'None', undefined];
    if (parseMode && !validParseModes.includes(parseMode)) {
      throw new AppError('parseMode must be "HTML", "Markdown", or "None"', 400, 'VALIDATION_ERROR');
    }

    // mozzarella-25815: reject the entire request if any group is out of scope.
    // Do not silently subset — caller must explicitly choose only in-scope cities.
    const ub = req.underboss!;
    const outOfScope = groups.filter((g: any) => !groupInBroadcastScope(g, { regions: ub.regions, cities: ub.cities || [] }));
    if (outOfScope.length > 0) {
      return res.status(400).json({
        error: 'OUT_OF_SCOPE',
        message: 'One or more groups are outside your assigned city scope',
        outOfScopeCities: outOfScope.map((g: any) => g.city || ''),
      });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    console.log(`[Telegram Broadcast] ${req.underboss!.email} sending to ${groups.length} groups at ${new Date().toISOString()}`);

    // calzone-58481: resolve each group's linked party server-side by chatId so
    // {link}/{appLink} use the authoritative DB association (never client-supplied).
    // Build a chatId -> party map for the groups in this request.
    const chatIds: bigint[] = [];
    for (const g of groups) {
      const idStr = String(g?.chatId ?? '').replace('#', '').trim();
      if (/^-?\d+$/.test(idStr)) chatIds.push(BigInt(idStr));
    }
    const groupRows = chatIds.length > 0
      ? await prisma.cityTelegramGroup.findMany({
          where: { chatId: { in: chatIds } },
          select: {
            chatId: true,
            party: { select: { customUrl: true, inviteCode: true } },
          },
        })
      : [];
    const partyByChatId = new Map<string, { customUrl: string | null; inviteCode: string | null } | null>();
    for (const row of groupRows) {
      partyByChatId.set(row.chatId.toString(), row.party);
    }

    const results: Array<{ chatId: string; city: string; success: boolean; error?: string; linkResolved?: boolean }> = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const { chatId, city, country } = group;

      if (!chatId) {
        results.push({ chatId: chatId || 'unknown', city: city || 'unknown', success: false, error: 'Missing chatId' });
        continue;
      }

      // Resolve per-recipient link tokens from the DB-linked party (if any).
      const linkedParty = partyByChatId.get(String(chatId).replace('#', '').trim()) ?? null;
      const linkUrl = publicEventLink(linkedParty);
      const appLinkUrl = appDeepLink(linkedParty, validatedAppTab);
      const usesLinkToken = /\{link\}|\{appLink\}/.test(message);
      const linkResolved = !usesLinkToken || (!!linkedParty && (linkUrl !== '' || appLinkUrl !== ''));

      // Replace template variables
      let personalizedMessage = message;
      personalizedMessage = personalizedMessage.replace(/\{city\}/g, city || '');
      personalizedMessage = personalizedMessage.replace(/\{country\}/g, country || '');
      // Substitute (and strip-if-unresolved) the per-recipient link tokens.
      personalizedMessage = substituteLinkTokens(personalizedMessage, linkUrl, appLinkUrl);
      personalizedMessage = withBennySignature(personalizedMessage);

      try {
        const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: personalizedMessage,
              ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
            }),
          }
        );

        let telegramResult = await telegramResponse.json();

        // Auto-retry if group was upgraded to supergroup
        if (!telegramResult.ok && telegramResult.parameters?.migrate_to_chat_id) {
          const newChatId = String(telegramResult.parameters.migrate_to_chat_id);
          console.log(`[Telegram Broadcast] Group ${chatId} migrated to ${newChatId}, retrying...`);
          const retryResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: newChatId,
                text: personalizedMessage,
                ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
              }),
            }
          );
          telegramResult = await retryResponse.json();
          if (telegramResult.ok) {
            results.push({ chatId, city: city || '', success: true, error: `Migrated: update DB chatId to ${newChatId}`, linkResolved });
          } else {
            results.push({ chatId, city: city || '', success: false, error: telegramResult.description || 'Failed after migration retry', linkResolved });
          }
        } else if (telegramResult.ok) {
          results.push({ chatId, city: city || '', success: true, linkResolved });
        } else {
          results.push({ chatId, city: city || '', success: false, error: telegramResult.description || 'Unknown Telegram error', linkResolved });
        }
      } catch (err: any) {
        results.push({
          chatId,
          city: city || '',
          success: false,
          error: err.message || 'Network error',
          linkResolved,
        });
      }

      // Rate limit: 100ms delay between messages
      if (i < groups.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[Telegram Broadcast] Complete: ${sent} sent, ${failed} failed`);

    res.json({ results, sent, failed });
  } catch (error) {
    next(error);
  }
});

// POST /host-broadcast — Send DM to multiple host private chats
router.post('/host-broadcast', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { hosts, message, parseMode, appTab } = req.body;

    if (!Array.isArray(hosts) || hosts.length === 0) {
      throw new AppError('hosts must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (hosts.length > 500) {
      throw new AppError('Maximum 500 hosts per request', 400, 'VALIDATION_ERROR');
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required', 400, 'VALIDATION_ERROR');
    }
    if (message.length > 4096) {
      throw new AppError('message must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    const validParseModes = ['HTML', 'Markdown', 'None', undefined];
    if (parseMode && !validParseModes.includes(parseMode)) {
      throw new AppError('parseMode must be "HTML", "Markdown", or "None"', 400, 'VALIDATION_ERROR');
    }

    // calzone-58481: validate optional {appLink} target tab.
    const validatedAppTab: string | null =
      appTab === undefined || appTab === null || appTab === ''
        ? null
        : isValidAppTab(appTab)
          ? appTab
          : (() => { throw new AppError('appTab is not a recognized app', 400, 'VALIDATION_ERROR'); })();

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    // Resolve chat_ids server-side from partyIds — NEVER trust a client-supplied chat_id.
    const partyIds: string[] = hosts
      .map((h: any) => h?.partyId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    if (partyIds.length === 0) {
      throw new AppError('No valid partyIds in hosts array', 400, 'VALIDATION_ERROR');
    }

    const partyRows = await prisma.party.findMany({
      where: { id: { in: partyIds }, hostTelegramChatId: { not: null } },
      // calzone-58481: customUrl + inviteCode added for {link}/{appLink} tokens.
      select: { id: true, hostTelegramChatId: true, name: true, customUrl: true, inviteCode: true },
    });
    const chatByPartyId = new Map<string, bigint>();
    const partyMetaById = new Map<string, { customUrl: string | null; inviteCode: string | null }>();
    for (const row of partyRows) {
      if (row.hostTelegramChatId !== null) {
        chatByPartyId.set(row.id, row.hostTelegramChatId);
      }
      partyMetaById.set(row.id, { customUrl: row.customUrl, inviteCode: row.inviteCode });
    }

    console.log(`[Telegram Host Broadcast] ${req.underboss!.email} sending to ${hosts.length} hosts (${partyRows.length} connected) at ${new Date().toISOString()}`);

    const results: Array<{
      partyId: string;
      city: string;
      hostName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i];
      const partyId: string = host?.partyId;
      const city: string = host?.city || '';
      const hostName: string = host?.hostName || '';

      if (!partyId || typeof partyId !== 'string') {
        results.push({ partyId: partyId || 'unknown', city, hostName, success: false, error: 'Missing partyId' });
        continue;
      }

      const chatId = chatByPartyId.get(partyId);
      if (chatId === undefined) {
        results.push({ partyId, city, hostName, success: false, error: 'Host has not connected Telegram' });
        continue;
      }

      // Replace template variables
      const partyMeta = partyMetaById.get(partyId) ?? null;
      let personalizedMessage = message;
      personalizedMessage = personalizedMessage.replace(/\{city\}/g, city);
      personalizedMessage = personalizedMessage.replace(/\{hostName\}/g, hostName);
      personalizedMessage = substituteLinkTokens(
        personalizedMessage,
        publicEventLink(partyMeta),
        appDeepLink(partyMeta, validatedAppTab)
      );
      personalizedMessage = withBennySignature(personalizedMessage);

      try {
        const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId.toString(),
              text: personalizedMessage,
              ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
            }),
          }
        );

        const telegramResult = await telegramResponse.json();

        if (telegramResult.ok) {
          results.push({ partyId, city, hostName, success: true });
        } else {
          const description: string = telegramResult.description || 'Unknown Telegram error';
          const errorCode: number = telegramResult.error_code || telegramResponse.status;

          // Special-case 403 "bot was blocked by the user" — auto-disconnect.
          // Treat any 403 with "blocked" or "deactivated" in the description as a
          // permanent disconnect (Telegram has a few variants).
          const isBlocked =
            errorCode === 403 &&
            /blocked by the user|user is deactivated|bot was kicked/i.test(description);

          if (isBlocked) {
            try {
              await prisma.party.update({
                where: { id: partyId },
                data: { hostTelegramChatId: null },
              });
            } catch (updateErr: any) {
              console.error(`[Telegram Host Broadcast] Failed to null chat_id for party ${partyId}:`, updateErr?.message || updateErr);
            }
            results.push({
              partyId,
              city,
              hostName,
              success: false,
              error: 'Host blocked the bot — disconnected',
            });
          } else {
            results.push({ partyId, city, hostName, success: false, error: description });
          }
        }
      } catch (err: any) {
        results.push({
          partyId,
          city,
          hostName,
          success: false,
          error: err?.message || 'Network error',
        });
      }

      // Rate limit: 100ms delay between messages (matches /broadcast)
      if (i < hosts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`[Telegram Host Broadcast] Complete: ${sent} sent, ${failed} failed`);

    res.json({ results, sent, failed });
  } catch (error) {
    next(error);
  }
});

// POST /host-test — Send a single test DM to one host (per-row Test button)
router.post('/host-test', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, message, parseMode } = req.body;

    if (!partyId || typeof partyId !== 'string') {
      throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required', 400, 'VALIDATION_ERROR');
    }
    if (message.length > 4096) {
      throw new AppError('message must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, hostTelegramChatId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    if (party.hostTelegramChatId === null) {
      return res.json({ partyId, success: false, error: 'Host has not connected Telegram' });
    }

    console.log(`[Telegram Host Test] ${req.underboss!.email} sending test to party ${partyId} at ${new Date().toISOString()}`);

    try {
      const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: party.hostTelegramChatId.toString(),
            text: withBennySignature(message),
            ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
          }),
        }
      );

      const telegramResult = await telegramResponse.json();

      if (telegramResult.ok) {
        return res.json({ partyId, success: true });
      }

      const description: string = telegramResult.description || 'Unknown Telegram error';
      const errorCode: number = telegramResult.error_code || telegramResponse.status;
      const isBlocked =
        errorCode === 403 &&
        /blocked by the user|user is deactivated|bot was kicked/i.test(description);

      if (isBlocked) {
        try {
          await prisma.party.update({
            where: { id: partyId },
            data: { hostTelegramChatId: null },
          });
        } catch (updateErr: any) {
          console.error(`[Telegram Host Test] Failed to null chat_id for party ${partyId}:`, updateErr?.message || updateErr);
        }
        return res.json({
          partyId,
          success: false,
          error: 'Host blocked the bot — disconnected',
        });
      }

      return res.json({ partyId, success: false, error: description });
    } catch (err: any) {
      return res.json({
        partyId,
        success: false,
        error: err?.message || 'Network error',
      });
    }
  } catch (error) {
    next(error);
  }
});

// POST /test — Send test message to single group
router.post('/test', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chatId, message, parseMode } = req.body;

    if (!chatId || typeof chatId !== 'string') {
      throw new AppError('chatId is required', 400, 'VALIDATION_ERROR');
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required', 400, 'VALIDATION_ERROR');
    }
    if (message.length > 4096) {
      throw new AppError('message must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    console.log(`[Telegram Test] ${req.underboss!.email} sending test to ${chatId} at ${new Date().toISOString()}`);

    try {
      const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: withBennySignature(message),
            ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
          }),
        }
      );

      let telegramResult = await telegramResponse.json();

      // Auto-retry if group was upgraded to supergroup
      if (!telegramResult.ok && telegramResult.parameters?.migrate_to_chat_id) {
        const newChatId = String(telegramResult.parameters.migrate_to_chat_id);
        console.log(`[Telegram Test] Group ${chatId} migrated to ${newChatId}, retrying...`);
        const retryResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: newChatId,
              text: withBennySignature(message),
              ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
            }),
          }
        );
        telegramResult = await retryResponse.json();
        if (telegramResult.ok) {
          res.json({ chatId, success: true, migratedTo: newChatId });
        } else {
          res.json({ chatId, success: false, error: telegramResult.description || 'Failed after migration retry' });
        }
      } else if (telegramResult.ok) {
        res.json({ chatId, success: true });
      } else {
        res.json({
          chatId,
          success: false,
          error: telegramResult.description || 'Unknown Telegram error',
        });
      }
    } catch (err: any) {
      res.json({
        chatId,
        success: false,
        error: err.message || 'Network error',
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
