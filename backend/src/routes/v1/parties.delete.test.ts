/**
 * Hackathon PR 2 (plan §16 party-deletion note): hackathons.party_id is RESTRICT, so the only
 * hard party delete (DELETE /api/v1/parties/:id) must not 500 on a party with a hackathon.
 * Setup-only hackathon -> deleted first in the same transaction; with projects -> 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const tx = vi.hoisted(() => ({
  hackathon: { findUnique: vi.fn(), delete: vi.fn() },
  hackathonSubmission: { count: vi.fn() },
  party: { delete: vi.fn() },
}));
const mockPrisma = vi.hoisted(() => ({
  party: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('../../helpers/auditContext.js', () => ({ setDeleteContext: vi.fn() }));
vi.mock('./guests.js', async () => ({ default: (await import('express')).Router() }));
vi.mock('../../middleware/apiKey.js', () => ({
  SCOPES: { PARTIES_READ: 'parties:read', PARTIES_WRITE: 'parties:write' },
  requireApiKey: () => (req: any, _res: any, next: any) => {
    req.apiKey = { userId: 'u1' };
    next();
  },
}));

import v1Parties, { isHackathonFkViolation } from './parties.js';
import { errorHandler } from '../../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/parties', v1Parties);
  a.use(errorHandler);
  return a;
}

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.party.findFirst.mockResolvedValue({ id: ID, userId: 'u1' });
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  tx.hackathon.findUnique.mockResolvedValue(null);
  tx.hackathonSubmission.count.mockResolvedValue(0);
  tx.party.delete.mockResolvedValue({ id: ID });
  tx.hackathon.delete.mockResolvedValue({});
});

describe('DELETE /api/v1/parties/:id with a hackathon', () => {
  it('no hackathon: deletes the party as before', async () => {
    const res = await request(app()).delete(`/api/v1/parties/${ID}`);
    expect(res.status).toBe(200);
    expect(tx.hackathon.delete).not.toHaveBeenCalled();
    expect(tx.party.delete).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('setup-only hackathon: deleted first in the same transaction, then the party', async () => {
    tx.hackathon.findUnique.mockResolvedValue({ id: 'h1' });
    const res = await request(app()).delete(`/api/v1/parties/${ID}`);
    expect(res.status).toBe(200);
    expect(tx.hackathon.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    expect(tx.hackathon.delete.mock.invocationCallOrder[0]).toBeLessThan(tx.party.delete.mock.invocationCallOrder[0]);
  });

  it('hackathon with projects: 409, nothing deleted', async () => {
    tx.hackathon.findUnique.mockResolvedValue({ id: 'h1' });
    tx.hackathonSubmission.count.mockResolvedValue(3);
    const res = await request(app()).delete(`/api/v1/parties/${ID}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HACKATHON_HAS_SUBMISSIONS');
    expect(tx.hackathon.delete).not.toHaveBeenCalled();
    expect(tx.party.delete).not.toHaveBeenCalled();
  });

  it('hackathon FK violation (race) maps to 409, not 500', async () => {
    tx.party.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003', meta: { field_name: 'hackathons_party_id_fkey (index)' } }));
    const res = await request(app()).delete(`/api/v1/parties/${ID}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HACKATHON_HAS_SUBMISSIONS');
  });

  it('any other FK violation keeps the previous behavior (500), not a misleading hackathon 409', async () => {
    tx.party.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003', meta: { field_name: 'payouts_party_id_fkey (index)' } }));
    const res = await request(app()).delete(`/api/v1/parties/${ID}`);
    expect(res.status).toBe(500);
  });

  it('isHackathonFkViolation reads meta.field_name / meta.constraint', () => {
    expect(isHackathonFkViolation({ code: 'P2003', meta: { constraint: 'hackathons_party_id_fkey' } })).toBe(true);
    expect(isHackathonFkViolation({ code: 'P2003', meta: {} })).toBe(false);
    expect(isHackathonFkViolation({ code: 'P2002', meta: { field_name: 'hackathons_x' } })).toBe(false);
  });
});
