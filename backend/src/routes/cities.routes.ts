import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/cities
 *
 * Returns the distinct list of cities currently hosting an approved/listed
 * GPP event. Powers the underboss `CityScopePicker` (no GPP sheet dependency).
 *
 * Excludes events explicitly rejected or hidden by an underboss.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.$queryRaw<Array<{ city: string; count: number }>>`
      SELECT city, COUNT(*)::int AS count
      FROM parties
      WHERE event_type = 'gpp'
        AND city IS NOT NULL
        AND city <> ''
        AND (underboss_status IS NULL OR underboss_status NOT IN ('rejected', 'hidden'))
      GROUP BY city
      ORDER BY city
    `;
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ cities: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
