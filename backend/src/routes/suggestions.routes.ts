import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isUnderboss } from '../middleware/auth.js';

const router = Router();

// GET /api/suggestions — view-only list of site-wide suggestions.
// Visible to full admins / super-admins and any active underboss.
// Suggestions are GLOBAL (no partyId) — every allowed viewer sees ALL of them.
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail?.toLowerCase();
    const allowed = (await isAdmin(email)) || (await isUnderboss(email));
    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const suggestions = await prisma.suggestion.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({ suggestions });
  } catch (e) {
    next(e);
  }
});

export default router;
