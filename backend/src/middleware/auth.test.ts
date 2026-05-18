import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret';

// Mock prisma
const mockPrisma = vi.hoisted(() => ({
  admin: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// Set JWT_SECRET before importing auth module
process.env.JWT_SECRET = JWT_SECRET;

import { requireAuth, optionalAuth, isAdmin, isSuperAdmin, isPaymentAdmin, isFullAdmin, AuthRequest } from './auth.js';
import { errorHandler } from './error.js';

function createTestApp(middleware: any) {
  const app = express();
  app.use(express.json());
  app.use(middleware);
  app.get('/test', (req: any, res) => {
    res.json({
      userId: req.userId || null,
      userEmail: req.userEmail || null,
    });
  });
  app.use(errorHandler);
  return app;
}

function makeToken(userId: string, email: string, expiresIn: string = '1h') {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn });
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through with valid JWT and sets userId/userEmail', async () => {
    const app = createTestApp(requireAuth);
    const token = makeToken('user-123', 'user@example.com');

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-123');
    expect(res.body.userEmail).toBe('user@example.com');
  });

  it('returns 401 when no token is provided', async () => {
    const app = createTestApp(requireAuth);

    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header has wrong format', async () => {
    const app = createTestApp(requireAuth);

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Basic some-token');

    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    const app = createTestApp(requireAuth);

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid-token-garbage');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for expired token', async () => {
    const app = createTestApp(requireAuth);
    const token = jwt.sign(
      { userId: 'user-123', email: 'user@example.com' },
      JWT_SECRET,
      { expiresIn: '-1s' } // Already expired
    );

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    // Note: TokenExpiredError extends JsonWebTokenError, so the middleware
    // catches it as INVALID_TOKEN due to check order. This documents the
    // current behavior (a known quirk in the error handling order).
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('optionalAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through with valid token and sets userId/userEmail', async () => {
    const app = createTestApp(optionalAuth);
    const token = makeToken('user-456', 'optional@example.com');

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-456');
    expect(res.body.userEmail).toBe('optional@example.com');
  });

  it('passes through without token (no userId set)', async () => {
    const app = createTestApp(optionalAuth);

    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
    expect(res.body.userEmail).toBeNull();
  });

  it('passes through with invalid token (silently ignores)', async () => {
    const app = createTestApp(optionalAuth);

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
    expect(res.body.userEmail).toBeNull();
  });
});

describe('isSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for super admin email', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'admin@example.com',
      role: 'super_admin',
    });

    const result = await isSuperAdmin('admin@example.com');
    expect(result).toBe(true);
  });

  it('returns false for regular admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'regular@example.com',
      role: 'admin',
    });

    const result = await isSuperAdmin('regular@example.com');
    expect(result).toBe(false);
  });

  it('returns false for non-admin email', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);

    const result = await isSuperAdmin('user@example.com');
    expect(result).toBe(false);
  });

  it('returns false for undefined email', async () => {
    const result = await isSuperAdmin(undefined);
    expect(result).toBe(false);
    // Should not call prisma when email is undefined
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });

  it('normalizes email to lowercase', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'admin@example.com',
      role: 'super_admin',
    });

    await isSuperAdmin('Admin@Example.COM');
    expect(mockPrisma.admin.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
    });
  });
});

describe('isAdmin (tightened — excludes payment_admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for role=admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(await isAdmin('admin@example.com')).toBe(true);
  });

  it('returns true for role=super_admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'super@example.com',
      role: 'super_admin',
    });
    expect(await isAdmin('super@example.com')).toBe(true);
  });

  // Behavioral change (arugula-38633 PR 2): payment_admin must NOT pass isAdmin.
  it('returns false for role=payment_admin (behavioral change)', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'finance@example.com',
      role: 'payment_admin',
    });
    expect(await isAdmin('finance@example.com')).toBe(false);
  });

  it('returns false when there is no admin row', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    expect(await isAdmin('nobody@example.com')).toBe(false);
  });

  it('returns false for undefined email', async () => {
    expect(await isAdmin(undefined)).toBe(false);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });
});

describe('isPaymentAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for role=payment_admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'finance@example.com',
      role: 'payment_admin',
    });
    expect(await isPaymentAdmin('finance@example.com')).toBe(true);
  });

  it('returns true for role=admin (full admins also get in)', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(await isPaymentAdmin('admin@example.com')).toBe(true);
  });

  it('returns true for role=super_admin (full admins also get in)', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'super@example.com',
      role: 'super_admin',
    });
    expect(await isPaymentAdmin('super@example.com')).toBe(true);
  });

  it('returns false for non-admin email (no admin row)', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    expect(await isPaymentAdmin('user@example.com')).toBe(false);
  });

  it('returns false for undefined email', async () => {
    expect(await isPaymentAdmin(undefined)).toBe(false);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });
});

describe('isFullAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for role=admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(await isFullAdmin('admin@example.com')).toBe(true);
  });

  it('returns true for role=super_admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'super@example.com',
      role: 'super_admin',
    });
    expect(await isFullAdmin('super@example.com')).toBe(true);
  });

  it('returns false for role=payment_admin', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      email: 'finance@example.com',
      role: 'payment_admin',
    });
    expect(await isFullAdmin('finance@example.com')).toBe(false);
  });

  it('returns false when there is no admin row', async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    expect(await isFullAdmin('user@example.com')).toBe(false);
  });

  it('returns false for undefined email', async () => {
    expect(await isFullAdmin(undefined)).toBe(false);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });
});
