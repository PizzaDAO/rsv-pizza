import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireUnderbossAuth, UnderbossAuthRequest } from '../middleware/underbossAuth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

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
