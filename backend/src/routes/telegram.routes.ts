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
    if (groups.length > 50) {
      throw new AppError('Maximum 50 groups per request', 400, 'VALIDATION_ERROR');
    }

    // Validate message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required', 400, 'VALIDATION_ERROR');
    }
    if (message.length > 4096) {
      throw new AppError('message must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    // Validate parseMode
    const validParseModes = ['HTML', 'Markdown', undefined];
    if (parseMode && !validParseModes.includes(parseMode)) {
      throw new AppError('parseMode must be "HTML" or "Markdown"', 400, 'VALIDATION_ERROR');
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
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: personalizedMessage,
              parse_mode: parseMode || 'HTML',
            }),
          }
        );

        const telegramResult = await telegramResponse.json();

        if (telegramResult.ok) {
          results.push({ chatId, city: city || '', success: true });
        } else {
          results.push({
            chatId,
            city: city || '',
            success: false,
            error: telegramResult.description || 'Unknown Telegram error',
          });
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
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: parseMode || 'HTML',
          }),
        }
      );

      const telegramResult = await telegramResponse.json();

      if (telegramResult.ok) {
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
