import { Router, Response, NextFunction } from 'express';
import { customAlphabet } from 'nanoid';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';

const router = Router();

router.use(requireAuth);

// URL-safe alphabet for nanoid (no ambiguous chars). 10 chars ~ 58 bits entropy.
const TOKEN_LENGTH = 10;
const generateToken = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  TOKEN_LENGTH,
);

/**
 * POST /api/parties/:partyId/connect-token
 *
 * Mints (or rotates) the host_telegram_link_token. Returns `{ token, deeplink }`.
 * Idempotent unless `?rotate=true` is passed: if a token already exists and
 * `rotate` is not set, the existing token is returned. With `?rotate=true`, a
 * fresh nanoid(10) is minted and the row is updated.
 */
router.post(
  '/:partyId/connect-token',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const rotate = req.query.rotate === 'true';

      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      const existing = await prisma.party.findUnique({
        where: { id: partyId },
        select: { hostTelegramLinkToken: true },
      });

      let token = existing?.hostTelegramLinkToken || null;
      if (rotate || !token) {
        // Generate a fresh token. The DB has a partial unique index but collisions
        // at this entropy are vanishingly rare — single attempt is fine.
        token = generateToken();
        await prisma.party.update({
          where: { id: partyId },
          data: { hostTelegramLinkToken: token },
        });
      }

      const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
      const deeplink = botUsername
        ? `https://t.me/${botUsername}?start=${token}`
        : null;

      res.json({ token, deeplink });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/parties/:partyId/host-telegram
 *
 * Disconnects: nulls both host_telegram_chat_id and host_telegram_link_token.
 */
router.delete(
  '/:partyId/host-telegram',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;

      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      await prisma.party.update({
        where: { id: partyId },
        data: {
          hostTelegramChatId: null,
          hostTelegramLinkToken: null,
        },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
