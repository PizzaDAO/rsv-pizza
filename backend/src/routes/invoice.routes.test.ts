import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

// ─── Prisma mock ────────────────────────────────────────────────────────────
const mockPrisma = vi.hoisted(() => ({
  invoice: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  party: {
    findUnique: vi.fn(),
  },
  sponsor: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (ops: any) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops(mockPrisma);
  }),
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// ─── Auth / access helpers ──────────────────────────────────────────────────
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      req.userId = payload.sub;
      req.userEmail = payload.email;
    } catch {
      req.userId = 'test-user-id';
      req.userEmail = 'host@test.com';
    }
    next();
  },
  AuthRequest: {},
}));

vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: vi.fn().mockResolvedValue(true),
  canUserAccessTab: vi.fn().mockResolvedValue(true),
}));

// ─── App setup ──────────────────────────────────────────────────────────────
async function buildApp() {
  const { invoiceHostRoutes } = await import('./invoice.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/parties', invoiceHostRoutes);
  return app;
}

function makeToken(sub = 'test-user-id', email = 'host@test.com') {
  return jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: '1h' });
}

// ─── Shared test data ────────────────────────────────────────────────────────
const PARTY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SPONSOR_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const baseSponsor = {
  id: SPONSOR_ID,
  partyId: PARTY_ID,
  name: 'Acme Corp',
  contactEmail: 'billing@acme.com',
  contactName: 'Jane Doe',
  amount: 500,
  sponsorshipType: 'gold',
  logoUrl: null,
};

const baseInvoice = {
  id: 'cccccccc-0000-0000-0000-000000000003',
  partyId: PARTY_ID,
  sponsorId: SPONSOR_ID,
  invoiceNumber: '2026-00001',
  viewToken: 'abc123token',
  billToCompany: 'Acme Corp',
  billToContact: 'Jane Doe',
  billToAddress: null,
  billToEmail: 'billing@acme.com',
  ccEmails: [],
  lineItems: [{ description: 'Gold Sponsorship', amount: 50000 }],
  total: 50000,
  currency: 'usd',
  paymentTerms: null,
  paymentInstructions: null,
  dueDate: null,
  memo: null,
  status: 'draft',
  paidAt: null,
  paidAmount: null,
  paymentMethod: null,
  paymentRef: null,
  sentAt: null,
  viewedAt: null,
  attachments: [],
  createdAt: new Date('2026-06-10T12:00:00Z'),
  updatedAt: new Date('2026-06-10T12:00:00Z'),
  sponsor: { id: SPONSOR_ID, name: 'Acme Corp', contactEmail: 'billing@acme.com', logoUrl: null },
};

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('POST /api/parties/:partyId/invoices — invoice numbering', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    // Default sponsor stub
    mockPrisma.sponsor.findFirst.mockResolvedValue(baseSponsor);
    // Default invoice create stub
    mockPrisma.invoice.create.mockResolvedValue(baseInvoice);
  });

  // ── Non-GPP event: year-prefixed number, no GPP- prefix ──────────────────
  it('generates a non-GPP number (year-NNNNN) for a non-gpp event', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: new Date('2026-07-15T18:00:00Z'),
      timezone: 'America/New_York',
    });
    // Allocation returns next_val = 1
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 1 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    // Verify the invoice was created with a non-GPP number
    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('2026-00001');
    expect(createCall.data.invoiceNumber).not.toMatch(/^GPP-/);
  });

  // ── GPP event: GPP-year-NNNNN format ─────────────────────────────────────
  it('generates a GPP-prefixed number for a gpp event', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'gpp',
      date: new Date('2026-07-15T18:00:00Z'),
      timezone: 'America/New_York',
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 1 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('GPP-2026-00001');
  });

  // ── 5-digit zero-padding ──────────────────────────────────────────────────
  it('zero-pads to 5 digits', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: new Date('2026-07-15T18:00:00Z'),
      timezone: 'UTC',
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 42 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('2026-00042');
  });

  // ── Two creates in same scope+year increment correctly ────────────────────
  it('increments counter: first create returns 00001, second returns 00002', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: new Date('2026-07-15T18:00:00Z'),
      timezone: 'UTC',
    });

    // First call: next_val = 1
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ next_val: 1 }]);
    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const firstCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(firstCall.data.invoiceNumber).toBe('2026-00001');

    // Reset create mock for second call
    mockPrisma.invoice.create.mockResolvedValue({ ...baseInvoice, invoiceNumber: '2026-00002' });

    // Second call: next_val = 2
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ next_val: 2 }]);
    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const secondCall = mockPrisma.invoice.create.mock.calls[1][0];
    expect(secondCall.data.invoiceNumber).toBe('2026-00002');
  });

  // ── Different year resets counter to 00001 ────────────────────────────────
  it('resets to 00001 for a different year', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: new Date('2027-01-20T18:00:00Z'),
      timezone: 'UTC',
    });
    // Allocation for 2027 scope returns 1 (independent counter)
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 1 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('2027-00001');
  });

  // ── GPP and non-GPP are independent sequences ─────────────────────────────
  it('GPP and non-GPP use independent sequences (scope passed to $queryRaw)', async () => {
    // GPP event
    mockPrisma.party.findUnique.mockResolvedValueOnce({
      eventType: 'gpp',
      date: new Date('2026-07-15T18:00:00Z'),
      timezone: 'UTC',
    });
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ next_val: 5 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const gppCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(gppCall.data.invoiceNumber).toBe('GPP-2026-00005');

    // Non-GPP event for same year: its own counter
    mockPrisma.party.findUnique.mockResolvedValueOnce({
      eventType: 'standard',
      date: new Date('2026-08-10T18:00:00Z'),
      timezone: 'UTC',
    });
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ next_val: 3 }]);
    mockPrisma.invoice.create.mockResolvedValueOnce({ ...baseInvoice, invoiceNumber: '2026-00003' });

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const nonGppCall = mockPrisma.invoice.create.mock.calls[1][0];
    expect(nonGppCall.data.invoiceNumber).toBe('2026-00003');
  });

  // ── Null start_time falls back to current year ────────────────────────────
  it('falls back to current year when party date is null', async () => {
    const currentYear = new Date().getUTCFullYear();
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: null,
      timezone: null,
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 1 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe(`${currentYear}-00001`);
  });

  // ── Timezone-local year is used for event spanning year boundary ──────────
  it('uses timezone-local year (e.g. Jan 1 UTC is still Dec 31 in US/Pacific)', async () => {
    // 2027-01-01T05:00:00Z = 2026-12-31 in America/Los_Angeles (UTC-8)
    mockPrisma.party.findUnique.mockResolvedValue({
      eventType: 'standard',
      date: new Date('2027-01-01T05:00:00Z'),
      timezone: 'America/Los_Angeles',
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ next_val: 1 }]);

    await request(app)
      .post(`/api/parties/${PARTY_ID}/invoices`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ sponsorId: SPONSOR_ID });

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    // Should be 2026 since the event is Dec 31 local time
    expect(createCall.data.invoiceNumber).toBe('2026-00001');
  });
});
