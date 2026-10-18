/**
 * calzone-70821: security tests for the token-based tax-form request flow.
 *
 * Uses a tiny in-memory Prisma fake (just the operations these routes use) so
 * conditional updateMany claims behave atomically like the real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;

// ---------------------------------------------------------------------------
// In-memory DB
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

const db = vi.hoisted(() => ({
  requests: [] as Record<string, any>[],
  forms: [] as Record<string, any>[],
  admins: [] as Record<string, any>[],
  seq: 0,
}));

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[k] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('notIn' in cond && (cond.notIn as unknown[]).includes(v)) return false;
      if ('in' in cond && !(cond.in as unknown[]).includes(v)) return false;
      if ('lt' in cond && !(v instanceof Date && v < cond.lt)) return false;
      continue;
    }
    if (v !== (cond ?? null)) return false;
  }
  return true;
}

function newestFirst(rows: Row[]) {
  return [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b._seq - a._seq);
}

function pick(row: Row | null, select?: Row) {
  if (!row || !select) return row;
  const out: Row = {};
  for (const k of Object.keys(select)) out[k] = row[k];
  return out;
}

const mockPrisma = vi.hoisted(() => ({}) as any);
Object.assign(mockPrisma, {
  admin: {
    findUnique: vi.fn(async ({ where }: any) => db.admins.find((a) => a.email === where.email) ?? null),
  },
  taxFormRequest: {
    findUnique: vi.fn(async ({ where }: any) => {
      const r = db.requests.find((x) => (where.token ? x.token === where.token : x.id === where.id));
      return r ? { ...r } : null;
    }),
    findMany: vi.fn(async ({ where, select }: any) =>
      db.requests.filter((r) => matches(r, where)).map((r) => pick({ ...r }, select)),
    ),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hits = db.requests.filter((r) => matches(r, where));
      for (const r of hits) Object.assign(r, data, { updatedAt: new Date() });
      return { count: hits.length };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = db.requests.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data, { updatedAt: new Date() });
      return { ...r, taxForm: null };
    }),
    create: vi.fn(async ({ data }: any) => {
      const r = {
        id: `req-${++db.seq}`,
        status: 'sent',
        userId: null,
        taxFormId: null,
        openedAt: null,
        submittedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      db.requests.push(r);
      return { ...r };
    }),
  },
  taxForm: {
    findFirst: vi.fn(async ({ where, select }: any) => {
      const r = newestFirst(db.forms.filter((f) => matches(f, where)))[0];
      return r ? pick({ ...r }, select) : null;
    }),
    findUnique: vi.fn(async ({ where, select }: any) => {
      const r = db.forms.find((f) => f.id === where.id);
      return r ? pick({ ...r }, select) : null;
    }),
    findMany: vi.fn(async ({ where }: any) => newestFirst(db.forms.filter((f) => matches(f, where))).map((f) => ({ ...f }))),
    create: vi.fn(async ({ data }: any) => {
      const f = {
        id: `form-${++db.seq}`,
        _seq: db.seq,
        userId: null,
        requestId: null,
        pdfUrl: null,
        pdfThumbUrl: null,
        signedAt: null,
        expiresAt: null,
        verifiedAt: null,
        verifiedBy: null,
        rejectedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      db.forms.push(f);
      return { ...f };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const f = db.forms.find((x) => x.id === where.id);
      if (!f) throw new Error('not found');
      Object.assign(f, data, { updatedAt: new Date(), _seq: ++db.seq });
      return { ...f };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hits = db.forms.filter((f) => matches(f, where));
      for (const f of hits) Object.assign(f, data, { updatedAt: new Date(), _seq: ++db.seq });
      return { count: hits.length };
    }),
  },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
});

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const storage = vi.hoisted(() => ({
  uploadTaxFormPdf: vi.fn(),
  getSignedTaxFormUrl: vi.fn(async (p: string | null) => (p ? `https://signed.example/${p}` : null)),
}));
vi.mock('../services/taxFormStorage.service.js', () => storage);

vi.mock('../services/taxFormPdf.service.js', () => ({
  generateW9PDF: vi.fn(async () => Buffer.from('%PDF-w9')),
  generateW8BENPDF: vi.fn(async () => Buffer.from('%PDF-w8ben')),
  generateW8BENEPDF: vi.fn(async () => Buffer.from('%PDF-w8bene')),
}));

import { publicTaxFormRequestRouter, adminTaxFormRequestRouter } from './tax-form-request.routes.js';
import { taxFormRouter, adminTaxFormRouter } from './tax-form.routes.js';
import { errorHandler } from '../middleware/error.js';
import { SECRET_KEYS } from '../services/taxFormCore.service.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/tax-form-requests', adminTaxFormRequestRouter);
  app.use('/api/admin/tax-forms', adminTaxFormRouter);
  app.use('/api/tax-form-requests', publicTaxFormRequestRouter);
  app.use('/api/tax-forms', taxFormRouter);
  app.use(errorHandler);
  return app;
}

const bearer = (userId: string, email: string) => `Bearer ${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' })}`;

let tokSeq = 0;
function seedRequest(over: Row = {}) {
  const token = `tok_${++tokSeq}_${'x'.repeat(40)}`;
  const r: Row = {
    id: `req-${++db.seq}`,
    token,
    requester: 'rare_pizzas',
    payeeLabel: 'Don Malbec',
    payeeEmail: 'don@example.com',
    payeeWallet: null,
    payeeHandle: null,
    suggestedFormType: 'w9',
    taxYearNote: null,
    userId: null,
    taxFormId: null,
    status: 'opened',
    openedAt: new Date(),
    submittedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  db.requests.push(r);
  return r;
}

function seedForm(over: Row) {
  const f: Row = {
    id: `form-${++db.seq}`,
    _seq: db.seq,
    userId: null,
    requestId: null,
    formType: 'w9',
    status: 'draft',
    formData: {},
    pdfUrl: null,
    pdfThumbUrl: null,
    signedAt: null,
    expiresAt: null,
    verifiedAt: null,
    verifiedBy: null,
    rejectedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  db.forms.push(f);
  return f;
}

const FULL_W9 = {
  name: 'Don Malbec',
  taxClassification: 'individual',
  address: '1 Pizza St',
  city: 'Brooklyn',
  state: 'NY',
  zipCode: '11201',
  ssn: '123-45-6789',
  signature: 'Don Malbec',
  date: '2026-10-18',
};

const SECRET_VALUES = {
  ssn: '123-45-6789',
  ein: '98-7654321',
  tin: 'TIN-SECRET',
  itin: '9XX-SECRET',
  usTin: 'US-TIN-SECRET',
  foreignTin: 'FOREIGN-TIN-SECRET',
  giin: 'GIIN-SECRET',
  dateOfBirth: '1980-01-02',
  accountNumbers: 'ACCT-SECRET',
  referenceNumbers: 'REF-SECRET',
};

beforeEach(() => {
  db.requests.length = 0;
  db.forms.length = 0;
  db.admins.length = 0;
  vi.clearAllMocks();
  storage.uploadTaxFormPdf.mockImplementation(async (_buf: Buffer, ownerKey: string, formType: string) => ({
    path: `${ownerKey}/${formType}-1.pdf`,
    thumbPath: null,
  }));
});

// ---------------------------------------------------------------------------
describe('(a) token flow never links a user, even with a valid Bearer token', () => {
  it('draft with Bearer header leaves userId null on form and request', async () => {
    const app = createApp();
    const req = seedRequest();
    const res = await request(app)
      .post(`/api/tax-form-requests/${req.token}/draft`)
      .set('Authorization', bearer('user-evil', 'evil@example.com'))
      .send({ formType: 'w9', formData: { name: 'Don' } });
    expect(res.status).toBe(200);
    expect(db.forms).toHaveLength(1);
    expect(db.forms[0].userId).toBeNull();
    expect(db.forms[0].requestId).toBe(req.id);
    expect(db.requests[0].userId).toBeNull();
    // Updating the existing draft with a Bearer header still never sets userId.
    await request(app)
      .post(`/api/tax-form-requests/${req.token}/draft`)
      .set('Authorization', bearer('user-evil', 'evil@example.com'))
      .send({ formType: 'w9', formData: { name: 'Don 2' } });
    expect(db.forms).toHaveLength(1);
    expect(db.forms[0].userId).toBeNull();
    for (const call of mockPrisma.taxForm.updateMany.mock.calls) expect(call[0].data).not.toHaveProperty('userId');
    for (const call of mockPrisma.taxFormRequest.updateMany.mock.calls) expect(call[0].data).not.toHaveProperty('userId');
  });

  it('submit with Bearer header leaves userId null on form and request', async () => {
    const app = createApp();
    const req = seedRequest();
    seedForm({ requestId: req.id, formData: { name: 'Don' } });
    const res = await request(app)
      .post(`/api/tax-form-requests/${req.token}/submit`)
      .set('Authorization', bearer('user-evil', 'evil@example.com'))
      .send({ formType: 'w9', formData: FULL_W9 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'submitted' });
    expect(db.forms[0].status).toBe('submitted');
    expect(db.forms[0].userId).toBeNull();
    expect(db.requests[0].userId).toBeNull();
    expect(db.requests[0].status).toBe('submitted');
    expect(storage.uploadTaxFormPdf.mock.calls[0][1]).toBe(`requests/${req.id}`);
    for (const call of mockPrisma.taxForm.update.mock.calls) expect(call[0].data).not.toHaveProperty('userId');
    for (const call of mockPrisma.taxFormRequest.update.mock.calls) expect(call[0].data).not.toHaveProperty('userId');
  });

  it('core services refuse a requestId owner that also carries a userId', async () => {
    const { saveTaxFormDraftCore, submitTaxFormCore } = await import('../services/taxFormCore.service.js');
    await expect(saveTaxFormDraftCore({ requestId: 'r1', userId: 'u1' }, 'w9', {})).rejects.toMatchObject({
      code: 'OWNER_CONFLICT',
    });
    await expect(submitTaxFormCore({ requestId: 'r1', userId: 'u1' }, 'w9', FULL_W9)).rejects.toMatchObject({
      code: 'OWNER_CONFLICT',
    });
    expect(db.forms).toHaveLength(0);
    expect(storage.uploadTaxFormPdf).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('(b) public GET never returns secrets or PDF urls', () => {
  it('strips every SECRET_KEY value and the signature, returns storedSecretFields (names only)', async () => {
    const app = createApp();
    const req = seedRequest();
    seedForm({
      requestId: req.id,
      formData: { name: 'Don', address: '1 Pizza St', signature: 'Don Malbec', ...SECRET_VALUES },
      pdfUrl: 'requests/x/w9-old.pdf',
    });
    const res = await request(app).get(`/api/tax-form-requests/${req.token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const v of Object.values(SECRET_VALUES)) expect(body).not.toContain(v);
    for (const k of SECRET_KEYS) expect(res.body.currentDraft.formData).not.toHaveProperty(k);
    expect(res.body.currentDraft.formData).not.toHaveProperty('signature');
    expect(body).not.toMatch(/pdf|signed\.example|form-\d/i);
    expect(res.body.currentDraft.formData).toEqual({ name: 'Don', address: '1 Pizza St' });
    expect([...res.body.storedSecretFields].sort()).toEqual([...SECRET_KEYS].sort());
    expect(storage.getSignedTaxFormUrl).not.toHaveBeenCalled();
  });

  it('submitted request: no currentDraft, no form data, no pdf url, locked', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'submitted' });
    const f = seedForm({ requestId: req.id, status: 'submitted', formData: FULL_W9, pdfUrl: 'requests/x/w9-1.pdf' });
    req.taxFormId = f.id;
    const res = await request(app).get(`/api/tax-form-requests/${req.token}`);
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.currentDraft).toBeNull();
    expect(res.body.storedSecretFields).toEqual([]);
    expect(res.body.submittedFormType).toBe('w9');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(FULL_W9.ssn);
    expect(body).not.toMatch(/pdf|signed\.example/i);
    expect(storage.getSignedTaxFormUrl).not.toHaveBeenCalled();
  });

  it('a submitting request is reported as locked', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'submitting' });
    const res = await request(app).get(`/api/tax-form-requests/${req.token}`);
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.currentDraft).toBeNull();
  });

  it('rejected reason persists after the payee starts a new draft', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'rejected' });
    const rej = seedForm({ requestId: req.id, status: 'rejected', rejectedReason: 'Name does not match TIN', formData: FULL_W9 });
    req.taxFormId = rej.id;
    const d = await request(app)
      .post(`/api/tax-form-requests/${req.token}/draft`)
      .send({ formType: 'w9', formData: { name: 'Don M' } });
    expect(d.status).toBe(200);
    expect(db.requests[0].status).toBe('draft');
    const res = await request(app).get(`/api/tax-form-requests/${req.token}`);
    expect(res.body.status).toBe('draft');
    expect(res.body.rejectedReason).toBe('Name does not match TIN');
    expect(JSON.stringify(res.body)).not.toContain(FULL_W9.ssn);
  });
});

// ---------------------------------------------------------------------------
describe('(c) invalid and revoked tokens are indistinguishable', () => {
  it('returns identical 404 bodies with no payee data', async () => {
    const app = createApp();
    const revoked = seedRequest({ revokedAt: new Date(), payeeLabel: 'Secret Payee' });
    const invalid = await request(app).get(`/api/tax-form-requests/tok_nope_${'y'.repeat(40)}`);
    const rev = await request(app).get(`/api/tax-form-requests/${revoked.token}`);
    const short = await request(app).get(`/api/tax-form-requests/abc`);
    expect(invalid.status).toBe(404);
    expect(rev.status).toBe(404);
    expect(short.status).toBe(404);
    expect(rev.body).toEqual(invalid.body);
    expect(short.body).toEqual(invalid.body);
    expect(invalid.body).toEqual({ error: { message: 'This link is invalid or no longer active.', code: 'INVALID_TOKEN' } });
    expect(JSON.stringify(rev.body)).not.toContain('Secret Payee');
  });

  it('revoked token cannot draft or submit (same 404)', async () => {
    const app = createApp();
    const revoked = seedRequest({ revokedAt: new Date() });
    const d = await request(app).post(`/api/tax-form-requests/${revoked.token}/draft`).send({ formType: 'w9', formData: {} });
    const s = await request(app).post(`/api/tax-form-requests/${revoked.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    expect(d.status).toBe(404);
    expect(s.status).toBe(404);
    expect(d.body.error.code).toBe('INVALID_TOKEN');
    expect(s.body.error.code).toBe('INVALID_TOKEN');
    expect(db.forms).toHaveLength(0);
    expect(storage.uploadTaxFormPdf).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('(d) locked requests reject draft and submit', () => {
  for (const status of ['submitted', 'verified', 'submitting']) {
    it(`draft and submit on a ${status} request -> 409, no new tax_forms row, no upload, status unchanged`, async () => {
      const app = createApp();
      const req = seedRequest({ status });
      const f = seedForm({ requestId: req.id, status: status === 'submitting' ? 'draft' : status, formData: FULL_W9 });
      req.taxFormId = f.id;
      const before = db.forms.length;
      const d = await request(app).post(`/api/tax-form-requests/${req.token}/draft`).send({ formType: 'w9', formData: { name: 'X' } });
      const s = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
      expect(d.status).toBe(409);
      expect(s.status).toBe(409);
      expect(d.body.error.code).toBe('TOKEN_LOCKED');
      expect(s.body.error.code).toBe('TOKEN_LOCKED');
      expect(db.forms.length).toBe(before);
      expect(mockPrisma.taxForm.create).not.toHaveBeenCalled();
      expect(mockPrisma.taxForm.updateMany).not.toHaveBeenCalled();
      expect(storage.uploadTaxFormPdf).not.toHaveBeenCalled();
      expect(db.requests[0].status).toBe(status);
    });
  }

  it('second submit after a successful submit -> 409, still one form, one upload', async () => {
    const app = createApp();
    const req = seedRequest();
    const ok = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    expect(ok.status).toBe(200);
    const again = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    const draft = await request(app).post(`/api/tax-form-requests/${req.token}/draft`).send({ formType: 'w9', formData: { name: 'X' } });
    expect(again.status).toBe(409);
    expect(draft.status).toBe(409);
    expect(db.forms).toHaveLength(1);
    expect(storage.uploadTaxFormPdf).toHaveBeenCalledTimes(1);
    expect(db.requests[0].status).toBe('submitted');
  });
});

// ---------------------------------------------------------------------------
describe('(e) submit claims the lock before upload', () => {
  it('concurrent submits: one wins, the other gets 409, upload called once', async () => {
    const app = createApp();
    const req = seedRequest();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let statusDuringUpload: string | null = null;
    storage.uploadTaxFormPdf.mockImplementation(async (_b: Buffer, ownerKey: string, formType: string) => {
      statusDuringUpload = db.requests[0].status;
      await gate;
      return { path: `${ownerKey}/${formType}-1.pdf`, thumbPath: null };
    });
    const first = request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 }).then((r) => r);
    // Wait until the first submit is inside the upload (lock held).
    for (let i = 0; i < 100 && storage.uploadTaxFormPdf.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(statusDuringUpload).toBe('submitting');
    const second = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('TOKEN_LOCKED');
    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect(storage.uploadTaxFormPdf).toHaveBeenCalledTimes(1);
    expect(db.forms.filter((f) => f.status === 'submitted')).toHaveLength(1);
    expect(db.requests[0].status).toBe('submitted');
  });

  it('a failed upload restores the previous status so the payee can retry', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'draft' });
    storage.uploadTaxFormPdf.mockRejectedValueOnce(new Error('storage down'));
    const res = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    expect(res.status).toBe(500);
    expect(db.requests[0].status).toBe('draft');
    const retry = await request(app).post(`/api/tax-form-requests/${req.token}/submit`).send({ formType: 'w9', formData: FULL_W9 });
    expect(retry.status).toBe(200);
    expect(db.requests[0].status).toBe('submitted');
  });

  it('validation failure releases the lock and uploads nothing', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'opened' });
    const res = await request(app)
      .post(`/api/tax-form-requests/${req.token}/submit`)
      .send({ formType: 'w9', formData: { ...FULL_W9, signature: '' } });
    expect(res.status).toBe(400);
    expect(storage.uploadTaxFormPdf).not.toHaveBeenCalled();
    expect(db.requests[0].status).toBe('opened');
  });

  it('a stored TIN is reused on submit when the payee leaves it blank (re-enter only to change)', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'draft' });
    seedForm({ requestId: req.id, formData: { ...FULL_W9, signature: 'old' } });
    const res = await request(app)
      .post(`/api/tax-form-requests/${req.token}/submit`)
      .send({ formType: 'w9', formData: { ...FULL_W9, ssn: '' } });
    expect(res.status).toBe(200);
    expect(db.forms[0].formData.ssn).toBe(FULL_W9.ssn);
    expect(db.forms[0].formData.signature).toBe(FULL_W9.signature);
  });
});

// ---------------------------------------------------------------------------
describe('(f) admin routes require a payment admin', () => {
  const adminPaths: Array<['get' | 'post', string]> = [
    ['get', '/api/admin/tax-form-requests'],
    ['post', '/api/admin/tax-form-requests'],
    ['post', '/api/admin/tax-form-requests/req-1/revoke'],
    ['post', '/api/admin/tax-form-requests/req-1/regenerate-token'],
    ['get', '/api/admin/tax-forms'],
    ['get', '/api/admin/tax-forms/form-1'],
    ['post', '/api/admin/tax-forms/form-1/verify'],
    ['post', '/api/admin/tax-forms/form-1/reject'],
  ];

  it('401 without auth', async () => {
    const app = createApp();
    for (const [m, p] of adminPaths) {
      const res = await request(app)[m](p).send({ label: 'X' });
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });

  it('403 for a logged-in non-payment-admin', async () => {
    const app = createApp();
    db.admins.push({ email: 'helper@example.com', role: 'underboss' });
    for (const email of ['nobody@example.com', 'helper@example.com']) {
      for (const [m, p] of adminPaths) {
        const res = await request(app)[m](p).set('Authorization', bearer('u-x', email)).send({ label: 'X' });
        expect(res.status, `${email} ${m} ${p}`).toBe(403);
      }
    }
    expect(db.requests).toHaveLength(0);
  });

  it('payment admin list is metadata only: no form_data, TINs or PDF paths/urls', async () => {
    const app = createApp();
    db.admins.push({ email: 'pay@example.com', role: 'payment_admin' });
    const req = seedRequest({ status: 'submitted' });
    const f = seedForm({ requestId: req.id, status: 'submitted', formData: FULL_W9, pdfUrl: 'requests/r/w9-1.pdf' });
    req.taxFormId = f.id;
    mockPrisma.taxFormRequest.findMany.mockImplementationOnce(async () =>
      db.requests.map((r) => ({ ...r, taxForm: { formType: 'w9' } })),
    );
    const res = await request(app).get('/api/admin/tax-form-requests').set('Authorization', bearer('u-p', 'pay@example.com'));
    expect(res.status).toBe(200);
    expect(mockPrisma.taxFormRequest.findMany.mock.calls[0][0].include).toEqual({ taxForm: { select: { formType: true } } });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(FULL_W9.ssn);
    expect(body).not.toMatch(/formData|form_data|pdf|signed\.example/i);
    expect(res.body.requests[0].token).toBe(req.token);
    expect(res.body.requests[0].formType).toBe('w9');
  });

  it('bulk create skips existing (non-revoked) and in-batch duplicates and reports them', async () => {
    const app = createApp();
    db.admins.push({ email: 'pay@example.com', role: 'payment_admin' });
    seedRequest({ payeeLabel: 'Alice', payeeEmail: 'Alice@Example.com' });
    seedRequest({ payeeLabel: 'Revoked Rita', payeeEmail: 'rita@example.com', revokedAt: new Date() });
    const res = await request(app)
      .post('/api/admin/tax-form-requests')
      .set('Authorization', bearer('u-p', 'pay@example.com'))
      .send({
        requests: [
          { label: 'Alice', email: 'alice@example.com' }, // exists (case-insensitive email)
          { label: 'Bob', email: 'bob@example.com' },
          { label: 'Bob', email: 'BOB@example.com' }, // repeat in batch
          { label: 'Revoked Rita', email: 'rita@example.com' }, // revoked one does not block
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.requests.map((r: any) => r.payeeLabel)).toEqual(['Bob', 'Revoked Rita']);
    expect(res.body.skipped).toEqual([
      { label: 'Alice', email: 'alice@example.com', reason: 'exists' },
      { label: 'Bob', email: 'BOB@example.com', reason: 'duplicate_in_batch' },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('(g) /api/tax-forms/me never returns a request-owned form', () => {
  it('lists only the user-owned form even if a request form carries the same userId', async () => {
    const app = createApp();
    const req = seedRequest({ status: 'submitted' });
    seedForm({ id: 'form-request', requestId: req.id, userId: 'user-1', status: 'submitted', formData: FULL_W9 });
    seedForm({ id: 'form-own', userId: 'user-1', status: 'draft', formData: { name: 'Me' } });
    const res = await request(app).get('/api/tax-forms/me').set('Authorization', bearer('user-1', 'u1@example.com'));
    expect(res.status).toBe(200);
    expect(res.body.taxForms.map((t: any) => t.id)).toEqual(['form-own']);
    expect(JSON.stringify(res.body)).not.toContain(FULL_W9.ssn);
    expect(mockPrisma.taxForm.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', requestId: null });
  });

  it('host draft/submit never touch a request-owned draft of the same user', async () => {
    const app = createApp();
    const req = seedRequest();
    seedForm({ id: 'form-request', requestId: req.id, userId: 'user-1', status: 'draft', formData: { name: 'Req' } });
    const res = await request(app)
      .post('/api/tax-forms/draft')
      .set('Authorization', bearer('user-1', 'u1@example.com'))
      .send({ formType: 'w9', formData: { name: 'Host' } });
    expect(res.status).toBe(201);
    expect(db.forms.find((f) => f.id === 'form-request')!.formData).toEqual({ name: 'Req' });
    expect(res.body.taxForm.id).not.toBe('form-request');
  });
});
