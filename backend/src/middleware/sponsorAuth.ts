import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest, isAdmin } from './auth.js';
import { AppError } from './error.js';

// Extend AuthRequest to include sponsorUser
export interface SponsorRequest extends AuthRequest {
  sponsorUser?: {
    id: string;
    email: string;
    name: string | null;
    tag: string;
    isActive: boolean;
  };
  isAdminViewing?: boolean;
}

// Login-based sponsor middleware — requires JWT auth, then looks up sponsor by email
// Admins and superadmins bypass the sponsor check and can view all dashboards
export async function requireSponsorAuth(
  req: SponsorRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Admins can access all sponsor dashboards
    if (await isAdmin(email)) {
      req.isAdminViewing = true;
      // Still check if admin is also a sponsor
      const sponsorUsers = await prisma.sponsorUser.findMany({
        where: { email: email.toLowerCase(), isActive: true },
        select: { id: true, email: true, name: true, tag: true, isActive: true },
      });
      if (sponsorUsers.length > 0) {
        const requestedTag = (req.query?.tag as string)?.trim().toLowerCase();
        const match = requestedTag
          ? sponsorUsers.find(s => s.tag === requestedTag)
          : sponsorUsers[0];
        req.sponsorUser = match || sponsorUsers[0];
      }
      return next();
    }

    // Look up sponsor by email
    const sponsorUsers = await prisma.sponsorUser.findMany({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
      },
    });

    if (sponsorUsers.length > 0) {
      const requestedTag = (req.query?.tag as string)?.trim().toLowerCase();
      const match = requestedTag
        ? sponsorUsers.find(s => s.tag === requestedTag)
        : sponsorUsers[0];

      if (requestedTag && !match) {
        throw new AppError('Not authorized for this tag', 403, 'FORBIDDEN');
      }

      const selected = match || sponsorUsers[0];
      req.sponsorUser = {
        id: selected.id,
        email: selected.email,
        name: selected.name,
        tag: selected.tag,
        isActive: selected.isActive,
      };
      return next();
    }

    // Not a sponsor
    throw new AppError('Not authorized as sponsor', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}
