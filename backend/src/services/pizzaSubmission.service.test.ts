/**
 * sfincione-40417 (submissions): pure helpers + approve/reject. Prisma and heavy deps mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sub: null as any,
  tx: [] as any[],
  createManyData: [] as any[],
  updateData: null as any,
  deleted: [] as any[],
}));

vi.mock('../config/database.js', () => {
  const prisma: any = {
    pizzaSubmission: {
      findUnique: vi.fn(async () => h.sub),
      update: vi.fn((args: any) => { h.updateData = args.data; return { __op: 'update' }; }),
    },
    pizzaLineItem: {
      deleteMany: vi.fn((args: any) => { h.deleted.push(args); return { __op: 'delete' }; }),
      createMany: vi.fn((args: any) => { h.createManyData = args.data; return { __op: 'create' }; }),
    },
    appConfig: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: any[]) => { h.tx = ops; return ops; }),
  };
  return { prisma };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }) }) } }),
}));
vi.mock('./ocr.service.js', () => ({ analyzeReceiptMulti: vi.fn() }));
vi.mock('./pdfRasterize.js', () => ({ rasterizePdfFirstPage: vi.fn() }));
vi.mock('./fx.service.js', () => ({ convertToUSD: vi.fn(async () => ({ exchangeRate: 0.5, source: 'jsdelivr' })) }));
vi.mock('./pizzaIndex.service.js', () => ({ invalidatePizzaIndexCache: vi.fn(), refreshOutliers: vi.fn(async () => undefined) }));
vi.mock('./pizzaLineSync.service.js', () => ({ loadPresets: vi.fn(async () => []), lineFingerprint: (n: string, q: number, u: number) => `${n}|${q}|${u}` }));

process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

import {
  approveSubmission,
  getSubmissionFx,
  isValidStoragePath,
  maxReceiptDate,
  ocrToDraft,
  parseDraft,
  rejectSubmission,
  sniffMime,
  validateSubmissionFields,
} from './pizzaSubmission.service.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('sniffMime', () => {
  const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(32)]);
  it('detects the allowed types by magic bytes', () => {
    expect(sniffMime(pad([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))).toBe('image/webp');
    expect(sniffMime(Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(8)]))).toBe('application/pdf');
    expect(sniffMime(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)]))).toBe('image/heic');
  });
  it('rejects everything else', () => {
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMime(Buffer.from('GIF89a' + 'x'.repeat(30)))).toBeNull();
    expect(sniffMime(Buffer.alloc(4))).toBeNull();
  });
});

describe('isValidStoragePath', () => {
  it('requires the caller folder', () => {
    expect(isValidStoragePath(`anon/${UUID}.png`, null)).toBe(true);
    expect(isValidStoragePath(`u1/${UUID}.pdf`, 'u1')).toBe(true);
    expect(isValidStoragePath(`u1/${UUID}.pdf`, null)).toBe(false);
    expect(isValidStoragePath(`anon/${UUID}.pdf`, 'u1')).toBe(false);
    expect(isValidStoragePath(`anon/${UUID}.exe`, null)).toBe(false);
    expect(isValidStoragePath(`anon/../${UUID}.png`, null)).toBe(false);
    expect(isValidStoragePath(42, null)).toBe(false);
  });
});

describe('validateSubmissionFields', () => {
  const base = { path: `anon/${UUID}.jpg`, receiptDate: '2025-05-05', merchant: ' Joe  &  Sons ', country: 'usa', city: 'Austin' };
  it('canonicalises country, derives year/region, trims text', () => {
    const f = validateSubmissionFields(base, null);
    expect(f.merchant).toBe('Joe & Sons');
    expect(f.country).toBe('United States');
    expect(f.countryCode).toBe('US');
    expect(f.year).toBe(2025);
    expect(f.email).toBeNull();
  });
  it('date bounds use UTC+14 for "today"', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(maxReceiptDate(now)).toBe('2026-11-08');
    expect(() => validateSubmissionFields({ ...base, receiptDate: '2026-11-08' }, null, now)).not.toThrow();
    expect(() => validateSubmissionFields({ ...base, receiptDate: '2026-11-09' }, null, now)).toThrow(/future/);
    expect(() => validateSubmissionFields({ ...base, receiptDate: '2020-12-31' }, null, now)).toThrow(/2021/);
  });
});

describe('ocrToDraft', () => {
  it('keeps pizza lines only; no pizza lines -> lump sum', () => {
    const mk = (lineItems: any[]) => ({ amount: 40, currency: 'EUR', confidence: 0.9, lineItems, merchant: 'M', receiptDate: '2025-01-02', pizzaCount: 3, raw: {} });
    const a = ocrToDraft(mk([
      { name: 'Margherita', qty: 2, unitPrice: 8, subtotal: 16, category: 'pizza', size: { label: 'large', diameterCm: 32 } },
      { name: 'Cola', qty: 2, unitPrice: 2, subtotal: 4, category: 'drink' },
    ]) as any);
    expect(a.kind).toBe('itemized');
    expect(a.lines).toEqual([{ name: 'Margherita', qty: 2, unitPrice: 8, sizeLabel: 'large', diameterCm: 32 }]);
    const b = ocrToDraft(mk([{ name: 'Cola', qty: 1, unitPrice: 2, subtotal: 2, category: 'drink' }]) as any);
    expect(b).toMatchObject({ kind: 'lump_sum', total: 40, pizzaCount: 3, currency: 'EUR' });
  });
});

describe('parseDraft', () => {
  it('validates kind, currency and lines', () => {
    expect(() => parseDraft(null)).toThrow();
    expect(() => parseDraft({ kind: 'nope' })).toThrow();
    expect(() => parseDraft({ kind: 'itemized', currency: 'euro', lines: [{ name: 'a', qty: 1, unitPrice: 1 }] })).toThrow(/currency/);
    expect(() => parseDraft({ kind: 'itemized', currency: 'EUR', lines: [] })).toThrow(/at least one/);
    expect(() => parseDraft({ kind: 'lump_sum', currency: 'EUR', total: 30 })).toThrow(/pizza count/);
    expect(() => parseDraft({ kind: 'itemized', currency: 'EUR', lines: [{ name: 'a', qty: -1, unitPrice: 1 }] })).toThrow();
    expect(parseDraft({ kind: 'not_pizza' }).lines).toEqual([]);
    const d = parseDraft({ kind: 'itemized', currency: 'eur', lines: [{ name: ' Marg ', qty: 2, unitPrice: 9.5 }] });
    expect(d.currency).toBe('EUR');
    expect(d.lines[0]).toMatchObject({ name: 'Marg', qty: 2, unitPrice: 9.5, category: 'pizza' });
  });
});

describe('getSubmissionFx', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  it('USD passes through; recent receipts use the live rate', async () => {
    expect((await getSubmissionFx('usd', '2026-01-01', now)).rate).toBe(1);
    expect(await getSubmissionFx('EUR', '2026-10-20', now)).toMatchObject({ rate: 0.5, source: 'jsdelivr' });
  });
  it('old receipts use the dated ECB rate and never the live one', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ rates: { USD: 1.1 }, date: '2023-05-05' }) })) as any;
    expect(await getSubmissionFx('EUR', '2023-05-06', now, f)).toEqual({ rate: 1.1, source: 'frankfurter:2023-05-05', date: '2023-05-05' });
    const none = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any;
    await expect(getSubmissionFx('VES', '2023-05-06', now, none)).rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
  });
});

describe('approveSubmission', () => {
  beforeEach(() => {
    h.tx = []; h.createManyData = []; h.updateData = null; h.deleted = [];
    h.sub = {
      id: 'sub-1', status: 'pending', merchant: 'Da Michele', city: 'Naples', country: 'Italy', countryCode: 'IT', region: 'western-europe',
      receiptDate: new Date('2026-10-10T00:00:00Z'), sizeNote: null, storagePath: 'anon/x.jpg', ocrImagePath: null,
      createdAt: new Date(), mimeType: 'image/jpeg', year: 2026,
    };
  });

  it('writes lines for the submission with updated_by set and no document/party', async () => {
    h.sub.status = 'pending';
    // getSubmission() re-reads the row after the transaction; hand back an approved copy
    const approved = { ...h.sub, status: 'approved' };
    const { prisma } = await import('../config/database.js');
    (prisma.pizzaSubmission.findUnique as any).mockResolvedValueOnce(h.sub).mockResolvedValue(approved);
    const r = await approveSubmission('sub-1', 'boss@x.com', {
      kind: 'itemized', currency: 'USD', lines: [{ name: 'Margherita 12 inch', qty: 2, unitPrice: 10 }],
    });
    expect(r.linesWritten).toBe(1);
    expect(h.createManyData).toHaveLength(1);
    const line = h.createManyData[0];
    expect(line).toMatchObject({ submissionId: 'sub-1', updatedBy: 'boss@x.com', rawName: 'Margherita 12 inch', currency: 'USD', fxRate: 1 });
    expect(line.documentId).toBeUndefined();
    expect(line.partyId).toBeUndefined();
    expect(line.historyReceiptId).toBeUndefined();
    expect(line.excludedReason).not.toBe('duplicate_line');
    expect(h.updateData).toMatchObject({ status: 'approved', reviewedBy: 'boss@x.com', kind: 'itemized', fxSource: 'usd-passthrough' });
    expect(h.deleted[0].where).toEqual({ submissionId: 'sub-1' });
  });

  it('refuses an already reviewed submission', async () => {
    h.sub.status = 'approved';
    await expect(approveSubmission('sub-1', 'boss@x.com', { kind: 'not_pizza' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('not_pizza approves with no lines', async () => {
    const { prisma } = await import('../config/database.js');
    (prisma.pizzaSubmission.findUnique as any).mockResolvedValueOnce(h.sub).mockResolvedValue({ ...h.sub, status: 'approved' });
    const r = await approveSubmission('sub-1', 'boss@x.com', { kind: 'not_pizza' });
    expect(r.linesWritten).toBe(0);
    expect(h.createManyData).toEqual([]);
  });
});

describe('rejectSubmission', () => {
  it('deletes the lines and marks rejected', async () => {
    h.deleted = [];
    h.sub = { id: 'sub-1', status: 'pending', storagePath: 'a', ocrImagePath: null, createdAt: new Date(), receiptDate: new Date(), mimeType: 'image/jpeg', merchant: 'M', country: 'Italy', year: 2026 };
    const { prisma } = await import('../config/database.js');
    (prisma.pizzaSubmission.findUnique as any).mockResolvedValue({ ...h.sub, status: 'rejected' });
    const dto = await rejectSubmission('sub-1', 'boss@x.com', 'duplicate');
    expect(h.deleted[0].where).toEqual({ submissionId: 'sub-1' });
    expect(h.updateData).toMatchObject({ status: 'rejected', rejectReason: 'duplicate', reviewedBy: 'boss@x.com' });
    expect(dto.status).toBe('rejected');
  });
});
