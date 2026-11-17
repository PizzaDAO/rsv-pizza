/**
 * Brand-admin access control (plans/wl-self-serve-brands.md §2.1).
 *
 * `requireSeriesAdmin` guards every `/api/brand-admin/:seriesId/...` route (run `requireAuth` first):
 *   - a super-admin passes for any existing series (actorKind 'super_admin');
 *   - otherwise the caller needs an ACTIVE `series_admins` row for that series whose email equals the
 *     JWT email (actorKind 'series_admin');
 *   - anything else is a 404, never a 403, so series ids can't be probed.
 * No caching: one indexed query, so a revoke takes effect on the very next request.
 *
 * Handlers must read the series id ONLY from `req.seriesAdmin.seriesId` and re-scope every child
 * lookup (`where: { id, seriesId }`).
 */
import type { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

export type SeriesActorKind = 'super_admin' | 'series_admin';

export interface SeriesAdminContext {
  seriesId: string;
  actorKind: SeriesActorKind;
  email: string;
}

export interface SeriesAdminRequest extends AuthRequest {
  seriesAdmin?: SeriesAdminContext;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new AppError('Not found', 404, 'NOT_FOUND');

export async function requireSeriesAdmin(req: SeriesAdminRequest, _res: Response, next: NextFunction) {
  try {
    const seriesId = req.params.seriesId;
    const email = (req.userEmail || '').toLowerCase();
    if (!seriesId || !UUID_RE.test(seriesId) || !email) throw notFound();

    if (await isSuperAdmin(email)) {
      const exists = await prisma.eventSeries.findUnique({ where: { id: seriesId }, select: { id: true } });
      if (!exists) throw notFound();
      req.seriesAdmin = { seriesId, actorKind: 'super_admin', email };
      return next();
    }

    const row = await prisma.seriesAdmin.findFirst({
      where: { seriesId, email, status: 'active', series: { is: { isActive: true } } },
      select: { id: true },
    });
    if (!row) throw notFound();
    req.seriesAdmin = { seriesId, actorKind: 'series_admin', email };
    next();
  } catch (e) {
    next(e);
  }
}
