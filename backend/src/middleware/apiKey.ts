import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { AppError } from './error.js';

// API Key prefix
export const API_KEY_PREFIX = 'rsvp_sk_';

// Available scopes
export const SCOPES = {
  PARTIES_READ: 'parties:read',
  PARTIES_WRITE: 'parties:write',
  GUESTS_READ: 'guests:read',
  GUESTS_WRITE: 'guests:write',
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',
} as const;

export type Scope = typeof SCOPES[keyof typeof SCOPES];

// Extended request with API key info
export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    userId: string;
    scopes: string[];
    rateLimit: number;
  };
}

// In-memory rate limit tracking (in production, use Redis)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Hash an API key for storage/comparison
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Generate a new API key
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `${API_KEY_PREFIX}${randomBytes}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, API_KEY_PREFIX.length + 8); // rsvp_sk_ + first 8 chars
  return { key, hash, prefix };
}

// Generate webhook secret
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Create HMAC signature for webhook payload
export function createWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Verify HMAC signature
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createWebhookSignature(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Check rate limit for an API key
function checkRateLimit(apiKeyId: string, rateLimit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  const key = `${apiKeyId}:${windowStart}`;
  const current = rateLimitMap.get(key);

  if (!current || current.windowStart !== windowStart) {
    // New window
    rateLimitMap.set(key, { count: 1, windowStart });
    return { allowed: true, remaining: rateLimit - 1, resetAt };
  }

  if (current.count >= rateLimit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  current.count++;
  return { allowed: true, remaining: rateLimit - current.count, resetAt };
}

// Middleware to require API key authentication
export function requireApiKey(...requiredScopes: Scope[]) {
  return async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AppError('API key required', 401, 'API_KEY_REQUIRED');
      }

      const key = authHeader.split(' ')[1];

      if (!key.startsWith(API_KEY_PREFIX)) {
        throw new AppError('Invalid API key format', 401, 'INVALID_API_KEY');
      }

      // Hash the key and look it up
      const keyHash = hashApiKey(key);
      const apiKey = await prisma.apiKey.findUnique({
        where: { key: keyHash },
      });

      if (!apiKey) {
        throw new AppError('Invalid API key', 401, 'INVALID_API_KEY');
      }

      // Check if key is approved
      if (apiKey.status !== 'approved') {
        throw new AppError('API key is not approved', 401, 'API_KEY_NOT_APPROVED');
      }

      // Check if key is revoked
      if (apiKey.revoked) {
        throw new AppError('API key has been revoked', 401, 'API_KEY_REVOKED');
      }

      // Check if key is expired
      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        throw new AppError('API key has expired', 401, 'API_KEY_EXPIRED');
      }

      // Check required scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every(scope => apiKey.scopes.includes(scope));
        if (!hasAllScopes) {
          throw new AppError(
            `Missing required scope(s): ${requiredScopes.filter(s => !apiKey.scopes.includes(s)).join(', ')}`,
            403,
            'INSUFFICIENT_SCOPE'
          );
        }
      }

      // Check rate limit
      const { allowed, remaining, resetAt } = checkRateLimit(apiKey.id, apiKey.rateLimit);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', apiKey.rateLimit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(resetAt / 1000));

      if (!allowed) {
        throw new AppError('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
      }

      // Update last used timestamp (non-blocking)
      prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      }).catch((err: Error) => console.error('Failed to update lastUsedAt:', err));

      // Attach API key info to request
      req.apiKey = {
        id: apiKey.id,
        userId: apiKey.userId,
        scopes: apiKey.scopes,
        rateLimit: apiKey.rateLimit,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Middleware to log API requests
export function logApiRequest() {
  return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Log on response finish
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;

      // Log request if we have an API key
      if (req.apiKey) {
        prisma.apiRequest.create({
          data: {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            responseTime,
            ip: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers['user-agent'] || null,
            apiKeyId: req.apiKey.id,
          },
        }).catch((err: Error) => console.error('Failed to log API request:', err));
      }
    });

    next();
  };
}
