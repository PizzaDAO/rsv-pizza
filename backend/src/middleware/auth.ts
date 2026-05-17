import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error.js';
import { prisma } from '../config/database.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// Check if the user is a full admin (DB-backed): role IN ('admin', 'super_admin').
// IMPORTANT: This was tightened on 2026-05-17 (arugula-38633 PR 2) to exclude the
// new 'payment_admin' role. payment_admin gates ONLY the future /payments dashboard
// and must NOT be treated as a regular admin anywhere else in the system.
export async function isAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return admin?.role === 'admin' || admin?.role === 'super_admin';
}

// Check if the user is a super admin (DB-backed)
export async function isSuperAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return admin?.role === 'super_admin';
}

// Check if the user is allowed in the host-payments dashboard: returns true for
// payment_admin, admin, OR super_admin. Full admins always get in too.
export async function isPaymentAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return (
    admin?.role === 'payment_admin' ||
    admin?.role === 'admin' ||
    admin?.role === 'super_admin'
  );
}

// Explicit "full admin powers needed" check: returns true ONLY for the two
// legacy full-admin roles. Use this when you want to be unambiguous that
// payment_admin should NOT qualify. Equivalent to the current isAdmin() but
// semantically clearer at the callsite.
export async function isFullAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  return admin?.role === 'admin' || admin?.role === 'super_admin';
}

// Check if the user is an active underboss (DB-backed)
export async function isUnderboss(email?: string): Promise<boolean> {
  if (!email) return false;
  const ub = await prisma.underboss.findFirst({
    where: { email: email.toLowerCase(), isActive: true },
    select: { id: true },
  });
  return !!ub;
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
