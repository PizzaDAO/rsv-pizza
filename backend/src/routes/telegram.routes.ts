import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireUnderbossAuth, UnderbossAuthRequest } from '../middleware/underbossAuth.js';
import { AppError } from '../middleware/error.js';
import { cityKeyFromPartyName, getGppRegionByCityKey } from '../helpers/underbossScope.js';
import { sendToCityGroup, persistCityGroupMigration } from '../services/cityTelegramGroup.js';
import { withBennySignature } from '../lib/bennySignature.js';
import { isValidAppTab } from '../lib/broadcastApps.js';

// Alias to keep the routes that were ported in from master readable.
type UnderbossRequest = UnderbossAuthRequest;

const router = Router();

// parmigiano-58493 (ported from calzone-58481 / PR #878): per-recipient
// {link}/{appLink} broadcast tokens. The TABLE REDESIGN from #878 (partyId FK on
// city_telegram_groups) was intentionally dropped — master keeps the live
// tonda-58293 city-keyed model — so the group path resolves a party by exact
// cityKey match (single GPP party) instead of a direct FK. The host path
// resolves authoritatively from each recipient's partyId.

/** Public event page URL for a party. Mirrors nft.routes.ts. */
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
 * recipient, missing slug, no app chosen) never ships as a literal.
 */
function substituteLinkTokens(message: string, linkUrl: string, appLinkUrl: string): string {
  let out = message;
  out = out.replace(/\{link\}/g, linkUrl || '');
  out = out.replace(/\{appLink\}/g, appLinkUrl || '');
  return out;
}

/**
 * parmigiano-58493: validate the optional {appLink} target tab from the request
 * body. Empty/absent → no app chosen ('' means the {appLink} token resolves to
 * empty and is stripped). An unrecognized tab is a hard 400 so a literal token
 * can never ship.
 */
function validateAppTab(appTab: unknown): string {
  if (appTab === undefined || appTab === null || appTab === '') return '';
  if (isValidAppTab(appTab)) return appTab;
  throw new AppError('appTab is not a recognized app', 400, 'VALIDATION_ERROR');
}

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

// POST /broadcast — Send message to multiple Telegram groups
router.post('/broadcast', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const { groups, message, parseMode, appTab } = req.body;

    // parmigiano-58493: validate optional {appLink} target tab (hard 400 if bad).
    const validatedAppTab = validateAppTab(appTab);

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

    // parmigiano-58493: resolve each group's event link server-side from a GPP
    // party matched by cityKey. master's city_telegram_groups has no partyId FK
    // (the #878 redesign was dropped), so we map the group's cityKey to a GPP
    // party via cityKeyFromPartyName(party.name). Only substitute when EXACTLY
    // ONE party matches a cityKey — ambiguous/no match leaves the token to be
    // stripped, so a broadcast never ships the wrong event's link.
    const usesLinkToken = /\{link\}|\{appLink\}/.test(message);
    const partyByCityKey = new Map<string, { customUrl: string | null; inviteCode: string | null } | null>();
    if (usesLinkToken) {
      const cityKeys = Array.from(
        new Set(
          groups
            .map((g: any) => (g?.city || '').toLowerCase().trim())
            .filter((c: string) => c.length > 0)
        )
      ) as string[];
      if (cityKeys.length > 0) {
        // Pull candidate GPP parties; match by cityKey derived from the name.
        const candidates = await prisma.party.findMany({
          where: { name: { startsWith: 'Global Pizza Party', mode: 'insensitive' } },
          select: { name: true, customUrl: true, inviteCode: true },
        });
        const wanted = new Set(cityKeys);
        const byKey = new Map<string, Array<{ customUrl: string | null; inviteCode: string | null }>>();
        for (const p of candidates) {
          const key = cityKeyFromPartyName(p.name);
          if (!key || !wanted.has(key)) continue;
          const arr = byKey.get(key) ?? [];
          arr.push({ customUrl: p.customUrl, inviteCode: p.inviteCode });
          byKey.set(key, arr);
        }
        for (const key of cityKeys) {
          const arr = byKey.get(key);
          // Only resolve on an unambiguous single match.
          partyByCityKey.set(key, arr && arr.length === 1 ? arr[0] : null);
        }
      }
    }

    const results: Array<{ chatId: string; city: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const { chatId, city, country } = group;

      if (!chatId) {
        results.push({ chatId: chatId || 'unknown', city: city || 'unknown', success: false, error: 'Missing chatId' });
        continue;
      }

      // parmigiano-58493: resolve per-recipient link tokens from the cityKey-matched party.
      const linkedParty = usesLinkToken ? (partyByCityKey.get((city || '').toLowerCase().trim()) ?? null) : null;
      const linkUrl = publicEventLink(linkedParty);
      const appLinkUrl = appDeepLink(linkedParty, validatedAppTab);

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
            // tonda-58293 FIX #6: persist the new supergroup id via the shared
            // helper. cityKey = lower(trim(city)); the broadcast `city` field is
            // the group's cityKey (already lowercased) so this updates the
            // existing row rather than creating an orphan. region set in-helper.
            await persistCityGroupMigration((city || '').toLowerCase().trim(), newChatId);
            results.push({ chatId, city: city || '', success: true, error: `Migrated to ${newChatId} (saved automatically)` });
          } else {
            results.push({ chatId, city: city || '', success: false, error: telegramResult.description || 'Failed after migration retry' });
          }
        } else if (telegramResult.ok) {
          results.push({ chatId, city: city || '', success: true });
        } else {
          results.push({ chatId, city: city || '', success: false, error: telegramResult.description || 'Unknown Telegram error' });
        }
      } catch (err: any) {
        results.push({
          chatId,
          city: city || '',
          success: false,
          error: err.message || 'Network error',
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

    // parmigiano-58493: validate optional {appLink} target tab (hard 400 if bad).
    const validatedAppTab = validateAppTab(appTab);

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
      // parmigiano-58493: customUrl + inviteCode added for {link}/{appLink} tokens.
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

      // parmigiano-58493: resolve per-recipient link tokens from the host's party.
      const partyMeta = partyMetaById.get(partyId) ?? null;
      const linkUrl = publicEventLink(partyMeta);
      const appLinkUrl = appDeepLink(partyMeta, validatedAppTab);

      // Replace template variables
      let personalizedMessage = message;
      personalizedMessage = personalizedMessage.replace(/\{city\}/g, city);
      personalizedMessage = personalizedMessage.replace(/\{hostName\}/g, hostName);
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

// GET /groups — DB-first read of the city → Telegram group mapping.
//
// tonda-58293: replaces the client-side Google Sheet fetch. Returns the
// `city_telegram_groups` rows the caller is allowed to see:
//   - Admin / graphics-admin (regions includes '__admin__') → all rows.
//   - Region-scoped UB with no explicit cities → rows whose `region` matches
//     one of the caller's assigned regions (case-insensitive). Now that the
//     region metadata lives in the DB we can push this predicate into the
//     query instead of returning everything.
//   - City-scoped UB → only rows whose city_key is in their assigned cities.
// Scoping is pushed into the Prisma `where` (never JS-filtered after a query).
// chatId is serialized to string because BigInt is not JSON-safe.
router.get('/groups', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const isAdminScope = ub.regions.includes('__admin__');
    const hasCities = (ub.cities?.length ?? 0) > 0;
    const regionOnly = !isAdminScope && ub.regions.length > 0 && !hasCities;

    type GroupWhere = {
      cityKey?: { in: string[] };
      region?: { in: string[]; mode: 'insensitive' };
    };
    let where: GroupWhere | undefined;
    if (isAdminScope) {
      // Full visibility for admins.
      where = undefined;
    } else if (regionOnly) {
      // Region-scoped UB: restrict to rows tagged with one of their regions.
      const regions = (ub.regions || []).map((r) => r.trim()).filter(Boolean);
      where = { region: { in: regions.length > 0 ? regions : ['__no_match__'], mode: 'insensitive' } };
    } else if (hasCities) {
      const cityKeys = (ub.cities || []).map((c) => c.toLowerCase().trim()).filter(Boolean);
      // Empty after normalization → return nothing.
      where = { cityKey: { in: cityKeys.length > 0 ? cityKeys : ['__no_match__'] } };
    } else {
      // Neither admin, nor region, nor cities → no access.
      where = { cityKey: { in: ['__no_match__'] } };
    }

    const rows = await prisma.cityTelegramGroup.findMany({
      where,
      orderBy: { cityKey: 'asc' },
    });

    res.json({
      groups: rows.map((r) => ({
        id: r.id,
        cityKey: r.cityKey,
        chatId: r.chatId !== null ? r.chatId.toString() : null,
        chatUrl: r.chatUrl,
        title: r.title,
        country: r.country,
        region: r.region,
        underboss: r.underboss,
        isSupergroup: r.isSupergroup,
        source: r.source,
        lastVerifiedAt: r.lastVerifiedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ─── tonda-58293 Phase 2: Telegram Groups gap report + assign + test ───────

/**
 * Scope helper shared by the Phase 2 endpoints. Returns the caller's effective
 * access derived from `req.underboss`:
 *   - admin: graphics-admin/admin (regions includes '__admin__')
 *   - regionOnly: region-scoped UB with no explicit cities
 *   - cityKeys: normalized lower(trim) city keys the UB is explicitly scoped to
 *   - regions: the UB's assigned regions (trimmed)
 */
function callerScope(ub: { regions: string[]; cities?: string[] }) {
  const admin = ub.regions.includes('__admin__');
  const cityKeys = (ub.cities || []).map((c) => c.toLowerCase().trim()).filter(Boolean);
  const regions = (ub.regions || []).map((r) => r.trim()).filter(Boolean);
  const regionOnly = !admin && regions.length > 0 && cityKeys.length === 0;
  return { admin, regionOnly, cityKeys, regions };
}

/**
 * Whether the caller may act on a specific cityKey (assign / test).
 *   - admin → always
 *   - city-scoped UB → cityKey must be one of their cities
 *   - region-scoped UB (no cities) → cityKey's `city_telegram_groups.region`
 *     must match one of their regions. (Cities with no row yet aren't region-
 *     resolvable here, so a region UB can only act on already-tagged cities;
 *     this mirrors the GET /groups region behavior.)
 */
async function callerOwnsCity(
  ub: { regions: string[]; cities?: string[] },
  cityKey: string,
): Promise<boolean> {
  const key = (cityKey || '').toLowerCase().trim();
  if (!key) return false;
  const scope = callerScope(ub);
  if (scope.admin) return true;
  if (scope.cityKeys.length > 0) {
    return scope.cityKeys.includes(key);
  }
  if (scope.regionOnly) {
    const row = await prisma.cityTelegramGroup.findUnique({
      where: { cityKey: key },
      select: { region: true },
    });
    if (!row || !row.region) return false;
    return scope.regions.map((r) => r.toLowerCase()).includes(row.region.toLowerCase());
  }
  return false;
}

// GET /groups/status — gap report: every GPP city (the universe) LEFT JOINed
// against `city_telegram_groups`, plus the pending (unassigned) captures.
router.get('/groups/status', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const scope = callerScope(ub);

    // Universe = distinct city keys from non-cancelled GPP parties, scoped in
    // the Prisma where (no JS post-filter).
    type PartyWhere = {
      eventType: string;
      cancelledAt: null;
      region?: { in: string[] };
      city?: { in: string[]; mode: 'insensitive' };
    };
    const where: PartyWhere = {
      eventType: 'gpp',
      cancelledAt: null,
    };
    if (!scope.admin) {
      if (scope.regionOnly) {
        where.region = { in: scope.regions.length > 0 ? scope.regions : ['__no_match__'] };
      } else if (scope.cityKeys.length > 0) {
        where.city = { in: scope.cityKeys, mode: 'insensitive' };
      } else {
        // No access
        where.region = { in: ['__no_match__'] };
      }
    }

    const parties = await prisma.party.findMany({
      where,
      select: { name: true },
    });

    // Distinct city keys from party names.
    const cityKeySet = new Set<string>();
    for (const p of parties) {
      const key = cityKeyFromPartyName(p.name);
      if (key) cityKeySet.add(key);
    }
    const cityKeys = Array.from(cityKeySet);

    // LEFT JOIN city_telegram_groups for the universe.
    const tgRows = cityKeys.length > 0
      ? await prisma.cityTelegramGroup.findMany({
          where: { cityKey: { in: cityKeys } },
        })
      : [];
    const tgByCity = new Map(tgRows.map((r) => [r.cityKey, r]));

    // Region UBs should also see any tagged-in-region cities that exist in
    // city_telegram_groups even if there is no GPP party (defensive). For
    // admins/city UBs the party-derived universe is authoritative.
    const cities = cityKeys
      .sort()
      .map((cityKey) => {
        const r = tgByCity.get(cityKey);
        return {
          cityKey,
          hasChatId: !!(r && r.chatId !== null),
          isSupergroup: r?.isSupergroup ?? false,
          source: r?.source ?? null,
          lastVerifiedAt: r?.lastVerifiedAt ?? null,
          chatUrl: r?.chatUrl ?? null,
          region: r?.region ?? null,
          country: r?.country ?? null,
        };
      });

    // Pending captures (unassigned). tonda-58293 FIX #8: admins see all; scoped
    // (region/city) UBs get an EMPTY list. An orphan capture's city is unknown
    // by definition, so showing every pending capture to a scoped UB was a
    // cross-region info leak (group titles from other regions). Assignment of an
    // orphan is therefore an admin-only action via /groups/assign.
    const pending = scope.admin
      ? await prisma.telegramGroupCapture.findMany({
          where: { assignedCityKey: null },
          orderBy: { lastSeenAt: 'desc' },
        })
      : [];

    res.json({
      cities,
      pendingCaptures: pending.map((c) => ({
        chatId: c.chatId.toString(),
        title: c.title,
        chatType: c.chatType,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /groups/assign — assign a pending capture to a city. Stamps the capture
// and writes through to city_telegram_groups (source='manual').
router.post('/groups/assign', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const { chatId, cityKey } = req.body || {};

    if (chatId === undefined || chatId === null || `${chatId}`.trim() === '') {
      throw new AppError('chatId is required', 400, 'VALIDATION_ERROR');
    }
    const key = typeof cityKey === 'string' ? cityKey.toLowerCase().trim() : '';
    if (!key) {
      throw new AppError('cityKey is required', 400, 'VALIDATION_ERROR');
    }

    let chatIdBig: bigint;
    try {
      chatIdBig = BigInt(`${chatId}`.trim());
    } catch {
      throw new AppError('chatId must be an integer', 400, 'VALIDATION_ERROR');
    }

    if (!(await callerOwnsCity(ub, key))) {
      throw new AppError('That city is outside your assigned scope', 403, 'FORBIDDEN');
    }

    const capture = await prisma.telegramGroupCapture.findUnique({
      where: { chatId: chatIdBig },
    });
    if (!capture) {
      throw new AppError('Capture not found', 404, 'NOT_FOUND');
    }

    const isSupergroup = capture.chatType === 'supergroup';
    // tonda-58293 FIX #1: populate region (GPP slug) so the new row is visible
    // to region-scoped underbosses. This is an explicit admin/scoped assign, so
    // it intentionally overwrites any existing chat_id for the city.
    const region = await getGppRegionByCityKey(key);

    await prisma.telegramGroupCapture.update({
      where: { chatId: chatIdBig },
      data: { assignedCityKey: key, autoMatched: false },
    });

    await prisma.cityTelegramGroup.upsert({
      where: { cityKey: key },
      create: {
        cityKey: key,
        chatId: chatIdBig,
        title: capture.title,
        isSupergroup,
        source: 'manual',
        region,
        lastVerifiedAt: new Date(),
      },
      update: {
        chatId: chatIdBig,
        title: capture.title,
        isSupergroup,
        source: 'manual',
        ...(region ? { region } : {}),
        lastVerifiedAt: new Date(),
      },
    });

    res.json({ ok: true, cityKey: key, chatId: chatIdBig.toString() });
  } catch (error) {
    next(error);
  }
});

// POST /groups/:cityKey/test — send a one-off test to the city's group.
router.post('/groups/:cityKey/test', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const key = (req.params.cityKey || '').toLowerCase().trim();
    if (!key) {
      throw new AppError('cityKey is required', 400, 'VALIDATION_ERROR');
    }
    if (!(await callerOwnsCity(ub, key))) {
      throw new AppError('That city is outside your assigned scope', 403, 'FORBIDDEN');
    }

    const result = await sendToCityGroup(
      key,
      '✅ PizzaDAO test — this city group is connected for reminders.',
    );

    res.json({ cityKey: key, ...result });
  } catch (error) {
    next(error);
  }
});

// POST /groups/:cityKey/refresh — re-verify a city's KNOWN group via getChat.
//
// tonda-58293 Phase 2 rework: capture is now discrete (my_chat_member +
// /register). This endpoint lets an underboss re-verify an already-captured
// group on demand: call Telegram getChat(chatId), then update title /
// is_supergroup / last_verified_at. If getChat reports the chat migrated to a
// supergroup (`migrate_to_chat_id` / parameters.migrate_to_chat_id), persist
// the new id + is_supergroup=true — mirroring the migration-persist logic in
// sendToCityGroup. Scope-checked. If the city has no chat_id on file, 400.
router.post('/groups/:cityKey/refresh', requireAuth, requireUnderbossAuth, async (req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
  try {
    const ub = req.underboss!;
    const key = (req.params.cityKey || '').toLowerCase().trim();
    if (!key) {
      throw new AppError('cityKey is required', 400, 'VALIDATION_ERROR');
    }
    if (!(await callerOwnsCity(ub, key))) {
      throw new AppError('That city is outside your assigned scope', 403, 'FORBIDDEN');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    const row = await prisma.cityTelegramGroup.findUnique({
      where: { cityKey: key },
      select: { chatId: true },
    });
    if (!row || row.chatId === null) {
      // No id to refresh — make the skip explicit for the UI.
      return res.status(400).json({
        error: 'NO_CHAT_ID',
        message: 'This city has no Telegram group on file yet — nothing to refresh.',
        cityKey: key,
      });
    }

    const getChat = async (chatId: string) => {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      });
      return resp.json() as Promise<any>;
    };

    const originalChatId = row.chatId.toString();
    let result = await getChat(originalChatId);

    // Handle supergroup migration: getChat on the old id reports the new one.
    // (Telegram surfaces it via parameters.migrate_to_chat_id; some clients
    // also see chat.migrate_to_chat_id once migrated.)
    const migratedTo =
      result?.parameters?.migrate_to_chat_id ?? result?.result?.migrate_to_chat_id ?? null;
    let effectiveChatId = originalChatId;
    let migrated = false;
    if (!result.ok && migratedTo) {
      effectiveChatId = String(migratedTo);
      migrated = true;
      console.log(`[tonda-58293][refresh] ${key} migrated ${originalChatId} -> ${effectiveChatId}, re-fetching...`);
      result = await getChat(effectiveChatId);
    }

    if (!result.ok) {
      return res.status(200).json({
        cityKey: key,
        ok: false,
        reason: result.description || 'getChat failed',
        chatId: originalChatId,
      });
    }

    const chat = result.result || {};
    const newChatId =
      typeof chat.id === 'number' || typeof chat.id === 'string' ? String(chat.id) : effectiveChatId;
    const title: string | null = typeof chat.title === 'string' ? chat.title : null;

    // tonda-58293 FIX #5: also treat a successful getChat whose returned chat.id
    // differs from the stored id as a migration (Telegram sometimes returns the
    // new supergroup id directly without an error). Combine with the existing
    // !ok + migrate_to_chat_id path above.
    if (!migrated && newChatId !== originalChatId) {
      migrated = true;
      console.log(`[tonda-58293][refresh] ${key} id changed ${originalChatId} -> ${newChatId} on getChat; treating as migration.`);
    }
    const isSupergroup = migrated ? true : chat.type === 'supergroup';

    // tonda-58293 FIX #6: on migration, persist via the shared helper (sets
    // chatId/isSupergroup/source='migration'/region/lastVerifiedAt) so all
    // three call sites behave identically. Then refresh the display title.
    if (migrated) {
      await persistCityGroupMigration(key, newChatId);
    }

    const updated = await prisma.cityTelegramGroup.update({
      where: { cityKey: key },
      data: {
        chatId: BigInt(newChatId),
        title,
        isSupergroup,
        source: migrated ? 'migration' : undefined,
        lastVerifiedAt: new Date(),
      },
    });

    res.json({
      cityKey: key,
      ok: true,
      migrated,
      group: {
        id: updated.id,
        cityKey: updated.cityKey,
        chatId: updated.chatId !== null ? updated.chatId.toString() : null,
        chatUrl: updated.chatUrl,
        title: updated.title,
        country: updated.country,
        region: updated.region,
        underboss: updated.underboss,
        isSupergroup: updated.isSupergroup,
        source: updated.source,
        lastVerifiedAt: updated.lastVerifiedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
