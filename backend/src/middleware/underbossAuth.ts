import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest, isAdmin } from './auth.js';
import { AppError } from './error.js';

/**
 * Authenticated request type for underboss-scoped routes.
 *
 * `req.underboss` is populated by `requireUnderbossAuth` and includes the
 * full scope (regions + cities). Admins and graphics-admins are surfaced via
 * the sentinel `regions: ['__admin__']`.
 */
export interface UnderbossAuthRequest extends AuthRequest {
  underboss?: {
    id: string;
    name: string;
    email: string;
    /** @deprecated single-region field — preserved for legacy callers. Prefer `regions`. */
    region: string;
    regions: string[];
    cities: string[];
    isActive: boolean;
  };
}

/**
 * Login-based underboss middleware. Requires JWT auth (caller must mount
 * `requireAuth` first), then looks up the underboss record by email and
 * attaches it as `req.underboss`.
 *
 * Authorizes admins, graphics-admins, and any active underboss with at
 * least one region OR city. Replaces the duplicated copies that previously
 * lived in `underboss.routes.ts` and `telegram.routes.ts`.
 */
export async function requireUnderbossAuth(
  req: UnderbossAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
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
        cities: [],
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
        cities: true,
        isActive: true,
      },
    });

    if (underboss) {
      // Fall back to [region] if regions array is empty (legacy data)
      const regions = underboss.regions.length > 0 ? underboss.regions : [underboss.region];
      const cities = underboss.cities || [];
      // Authorize if scoped to at least one region OR city
      if (regions.length === 0 && cities.length === 0) {
        throw new AppError('Not authorized as underboss', 403, 'FORBIDDEN');
      }
      req.underboss = {
        id: underboss.id,
        name: underboss.name,
        email: underboss.email,
        region: underboss.region,
        regions,
        cities,
        isActive: underboss.isActive,
      };
      return next();
    }

    // Check if user is a graphics admin (preserve existing behavior)
    const graphicsAdmin = await prisma.graphicsAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (graphicsAdmin) {
      req.underboss = {
        id: 'graphics-admin',
        name: graphicsAdmin.name || 'Graphics Admin',
        email,
        region: '__admin__',
        regions: ['__admin__'],
        cities: [],
        isActive: true,
      };
      return next();
    }

    throw new AppError('Not authorized as underboss', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}
