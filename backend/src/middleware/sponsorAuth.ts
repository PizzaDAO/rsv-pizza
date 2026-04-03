import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from './auth.js';
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
}

// Login-based sponsor middleware — requires JWT auth, then looks up sponsor by email
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

    // Look up sponsor by email
    const sponsorUser = await prisma.sponsorUser.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
      },
    });

    if (sponsorUser) {
      req.sponsorUser = {
        id: sponsorUser.id,
        email: sponsorUser.email,
        name: sponsorUser.name,
        tag: sponsorUser.tag,
        isActive: sponsorUser.isActive,
      };
      return next();
    }

    // Not a sponsor
    throw new AppError('Not authorized as sponsor', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}
