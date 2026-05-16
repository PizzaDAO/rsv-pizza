import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Extend Request to include underboss (same pattern as underboss.routes.ts)
interface UnderbossRequest extends AuthRequest {
  underboss?: {
    id: string;
    name: string;
    email: string;
    region: string;
    regions: string[];
    isActive: boolean;
  };
}

// Login-based underboss middleware (duplicated from underboss.routes.ts to avoid refactoring)
async function requireUnderbossAuth(
  req: UnderbossRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Check if user is an admin first
    if (await isAdmin(email)) {
      req.underboss = {
        id: 'admin',
        name: 'Admin',
        email,
        region: '__admin__',
        regions: ['__admin__'],
        isActive: true,
      };
      return next();
    }

    // Look up underboss by email
    const underboss = await prisma.underboss.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        regions: true,
        isActive: true,
      },
    });

    if (underboss) {
      const regions = underboss.regions.length > 0 ? underboss.regions : [underboss.region];
      req.underboss = {
        id: underboss.id,
        name: underboss.name,
        email: underboss.email,
        region: underboss.region,
        regions,
        isActive: underboss.isActive,
      };
      return next();
    }

    // Neither underboss nor admin
    throw new AppError('Not authorized as underboss', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}

const router = Router();

// POST /broadcast — Send message to multiple Telegram groups
router.post('/broadcast', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { groups, message, parseMode } = req.body;

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

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500, 'CONFIG_ERROR');
    }

    console.log(`[Telegram Broadcast] ${req.underboss!.email} sending to ${groups.length} groups at ${new Date().toISOString()}`);

    const results: Array<{ chatId: string; city: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const { chatId, city, country } = group;

      if (!chatId) {
        results.push({ chatId: chatId || 'unknown', city: city || 'unknown', success: false, error: 'Missing chatId' });
        continue;
      }

      // Replace template variables
      let personalizedMessage = message;
      personalizedMessage = personalizedMessage.replace(/\{city\}/g, city || '');
      personalizedMessage = personalizedMessage.replace(/\{country\}/g, country || '');

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
            results.push({ chatId, city: city || '', success: true, error: `Migrated: update sheet to ${newChatId}` });
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
    const { hosts, message, parseMode } = req.body;

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
      select: { id: true, hostTelegramChatId: true, name: true },
    });
    const chatByPartyId = new Map<string, bigint>();
    for (const row of partyRows) {
      if (row.hostTelegramChatId !== null) {
        chatByPartyId.set(row.id, row.hostTelegramChatId);
      }
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
      let personalizedMessage = message;
      personalizedMessage = personalizedMessage.replace(/\{city\}/g, city);
      personalizedMessage = personalizedMessage.replace(/\{hostName\}/g, hostName);

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
            text: message,
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
router.post('/test', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
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
            text: message,
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
              text: message,
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
