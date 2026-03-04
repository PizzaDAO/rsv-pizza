import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error.js';
import { prisma } from '../config/database.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// Check if the user is any kind of admin (DB-backed)
export async function isAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return !!admin;
}

// Check if the user is a super admin (DB-backed)
export async function isSuperAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return admin?.role === 'super_admin';
}

// Optional auth: tries to parse the JWT but doesn't error if missing/invalid
export const optionalAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const decoded = jwt.verify(token, secret) as { userId: string; email: string };
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
      }
    }
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
  next();
};

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new AppError('JWT secret not configured', 500, 'CONFIG_ERROR');
    }

    const decoded = jwt.verify(token, secret) as { userId: string; email: string };

    req.userId = decoded.userId;
    req.userEmail = decoded.email;

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
    } else {
      next(error);
    }
  }
};
