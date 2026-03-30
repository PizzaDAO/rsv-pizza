import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted to create mocks
const mockPrisma = vi.hoisted(() => ({
  party: {
    findUnique: vi.fn(),
  },
  guest: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// Mock webhook service
vi.mock('../services/webhook.service.js', () => ({
  triggerWebhook: vi.fn(),
}));

// Mock fetch for email sending
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import rsvpRoutes from './rsvp.routes.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rsvp', rsvpRoutes);
  app.use(errorHandler);
  return app;
}

const PARTY_ID = 'party-001';
const INVITE_CODE = 'abc123';

const BASE_PARTY = {
  id: PARTY_ID,
  name: 'Test Party',
  date: new Date('2026-06-15T18:00:00Z'),
  eventType: null,
  rsvpClosedAt: null,
  maxGuests: null,
  requireApproval: false,
  availableBeverages: ['water', 'soda'],
  userId: 'host-123',
  user: { name: 'Host User' },
  customUrl: null,
  timezone: 'America/New_York',
  address: '123 Pizza St',
};

describe('RSVP Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no RESEND_API_KEY so emails are skipped
    delete process.env.RESEND_API_KEY;
  });

  describe('GET /api/rsvp/:inviteCode - Get party info', () => {
    it('returns party info for valid invite code', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        guests: [
          { status: 'CONFIRMED' },
          { status: 'CONFIRMED' },
          { status: 'WAITLISTED' },
        ],
      });

      const res = await request(app).get(`/api/rsvp/${INVITE_CODE}`);

      expect(res.status).toBe(200);
      expect(res.body.party.name).toBe('Test Party');
      expect(res.body.party.guestCount).toBe(2); // Only CONFIRMED
      expect(res.body.party.waitlistCount).toBe(1);
      expect(res.body.rsvpClosed).toBe(false);
    });

    it('falls back to custom URL lookup', async () => {
      const app = createTestApp();
      // First call (inviteCode) returns null
      mockPrisma.party.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...BASE_PARTY,
          guests: [{ status: 'CONFIRMED' }],
        });

      const res = await request(app).get('/api/rsvp/my-custom-url');

      expect(res.status).toBe(200);
      // Should have tried findUnique twice (inviteCode then customUrl)
      expect(mockPrisma.party.findUnique).toHaveBeenCalledTimes(2);
    });

    it('returns 404 for invalid invite code', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const res = await request(app).get('/api/rsvp/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTY_NOT_FOUND');
    });

    it('returns rsvpClosed when RSVPs are closed', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        rsvpClosedAt: new Date(),
        guests: [],
      });

      const res = await request(app).get(`/api/rsvp/${INVITE_CODE}`);

      expect(res.status).toBe(200);
      expect(res.body.rsvpClosed).toBe(true);
    });

    it('shows isAtCapacity when maxGuests reached', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        maxGuests: 2,
        guests: [
          { status: 'CONFIRMED' },
          { status: 'CONFIRMED' },
        ],
      });

      const res = await request(app).get(`/api/rsvp/${INVITE_CODE}`);

      expect(res.status).toBe(200);
      expect(res.body.party.isAtCapacity).toBe(true);
    });

    it('counts PENDING guests towards capacity', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        maxGuests: 2,
        guests: [
          { status: 'CONFIRMED' },
          { status: 'PENDING' },
        ],
      });

      const res = await request(app).get(`/api/rsvp/${INVITE_CODE}`);

      expect(res.body.party.guestCount).toBe(2);
      expect(res.body.party.isAtCapacity).toBe(true);
    });
  });

  describe('POST /api/rsvp/:inviteCode/guest - Submit RSVP', () => {
    beforeEach(() => {
      mockPrisma.guest.findFirst.mockResolvedValue(null); // No duplicate
    });

    it('creates a guest with CONFIRMED status', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        _count: { guests: 0 },
      });
      mockPrisma.guest.count.mockResolvedValue(0); // No confirmed guests
      mockPrisma.guest.create.mockResolvedValue({
        id: 'guest-001',
        name: 'New Guest',
        status: 'CONFIRMED',
      });

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({
          name: 'New Guest',
          email: 'guest@example.com',
          dietaryRestrictions: ['Vegetarian'],
          likedToppings: ['mushrooms'],
          dislikedToppings: ['anchovies'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.guest.status).toBe('CONFIRMED');
      expect(res.body.waitlisted).toBe(false);
    });

    it('validates name is required', async () => {
      const app = createTestApp();

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({ email: 'guest@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates name is not empty string', async () => {
      const app = createTestApp();

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({ name: '  ', email: 'guest@example.com' });

      expect(res.status).toBe(400);
    });

    it('rejects RSVP when RSVPs are closed', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        rsvpClosedAt: new Date(),
        _count: { guests: 0 },
      });

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({ name: 'Late Guest' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RSVP_CLOSED');
    });

    it('waitlists guest when at capacity', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        maxGuests: 2,
        _count: { guests: 5 },
      });
      mockPrisma.guest.count.mockResolvedValue(2); // At capacity
      mockPrisma.guest.aggregate.mockResolvedValue({ _max: { waitlistPosition: 3 } });
      mockPrisma.guest.create.mockResolvedValue({
        id: 'guest-waitlisted',
        name: 'Waitlisted Guest',
        status: 'WAITLISTED',
        waitlistPosition: 4,
      });

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({ name: 'Waitlisted Guest' });

      expect(res.status).toBe(201);
      expect(res.body.waitlisted).toBe(true);
      expect(res.body.waitlistPosition).toBe(4);
    });

    it('sets PENDING status when requireApproval is true', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        requireApproval: true,
        _count: { guests: 0 },
      });
      mockPrisma.guest.count.mockResolvedValue(0);
      mockPrisma.guest.create.mockResolvedValue({
        id: 'guest-pending',
        name: 'Pending Guest',
        status: 'PENDING',
      });

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({ name: 'Pending Guest' });

      expect(res.status).toBe(201);
      expect(res.body.requireApproval).toBe(true);
    });

    it('updates existing guest on duplicate email', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({
        ...BASE_PARTY,
        _count: { guests: 1 },
      });
      mockPrisma.guest.count.mockResolvedValue(1);
      // Duplicate guest found
      mockPrisma.guest.findFirst.mockResolvedValue({
        id: 'guest-existing',
        name: 'Old Name',
        email: 'duplicate@example.com',
      });
      mockPrisma.guest.update.mockResolvedValue({
        id: 'guest-existing',
        name: 'Updated Name',
        email: 'duplicate@example.com',
      });

      const res = await request(app)
        .post(`/api/rsvp/${INVITE_CODE}/guest`)
        .send({
          name: 'Updated Name',
          email: 'duplicate@example.com',
          dietaryRestrictions: ['Vegan'],
        });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
    });

    it('returns 404 for non-existent party', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/rsvp/nonexistent/guest')
        .send({ name: 'Ghost Guest' });

      expect(res.status).toBe(404);
    });
  });
});
