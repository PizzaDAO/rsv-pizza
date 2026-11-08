/**
 * sfincione-40417 (submissions): public receipt submissions to the Pizza Price Index.
 *
 * Anyone (logged in or not) can send a receipt. It lands as `pending` in
 * pizza_submissions; a full admin reads it (OCR runs only then), edits the lines and
 * approves; approved lines join the index as origin 'submission'.
 *
 * SECURITY: receipt files live in the PRIVATE `pizza-index-submissions` bucket
 * (created in the Supabase dashboard, never in code). Only object PATHS are stored;
 * admins get short-lived signed URLs minted per request. No path, URL or submitter
 * email ever reaches a public payload.
 *
 * Anti-abuse (no captcha in v1): honeypot (route), per-IP limits (3/hour, 10/day via
 * ip_hash), a global cap of 300 pending, magic-byte sniffing, sha256 dedupe, and OCR
 * only when an admin opens a submission.
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { canonicalizeCountryName } from '../lib/canonicalCountryName.js';
import { getCountryCode } from '../lib/countryCode.js';
import { countryCodeToRegion, countryNameToRegion } from '../lib/countryRegion.js';
import { sanitizePgString } from '../lib/sanitizePg.js';
import { analyzeReceiptMulti, type OcrResult } from './ocr.service.js';
import { rasterizePdfFirstPage } from './pdfRasterize.js';
import { convertToUSD } from './fx.service.js';
import { loadPresets } from './pizzaLineSync.service.js';
import { buildHistoryLines, type HistoryKind, type HistoryLineIn, type HistoryRecord } from './pizzaManualLines.js';
import { normalizeMerchantKey } from './pizzaSize.service.js';
import { invalidatePizzaIndexCache, refreshOutliers } from './pizzaIndex.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUBMISSIONS_BUCKET = 'pizza-index-submissions';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SUBMISSION_FIRST_DATE = '2021-01-01';
export const SIGNED_URL_TTL_SECONDS = 60 * 30;
export const LIMITS = { perHour: 3, perDay: 10, globalPending: 300 } as const;
/** Honeypot field name (a hidden input real users never fill). */
export const HONEYPOT_FIELD = 'website';

export const FLAG_ENABLED = 'pizza_index.submissions_enabled';
export const FLAG_PUBLIC = 'pizza_index.submissions_public';

export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

let _client: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for pizza submissions');
  _client = createClient(url, key);
  return _client;
}
const bucket = () => getSupabaseAdmin().storage.from(SUBMISSIONS_BUCKET);

// ---------------------------------------------------------------------------
// Flags (app_config)
// ---------------------------------------------------------------------------

/** app_config boolean: 'true'/'false' strings; a missing row (or a read failure) gives `fallback`. */
export async function getConfigFlag(key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await prisma.appConfig.findUnique({ where: { key } });
    if (!row) return fallback;
    const v = row.value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/** Kill switch for the public routes. Off until Snax sets pizza_index.submissions_enabled = 'true'. */
export const submissionsEnabled = () => getConfigFlag(FLAG_ENABLED, false);

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export function hashIp(ip: string | undefined): string {
  const secret = process.env.PIZZA_SUBMISSION_IP_SECRET || process.env.JWT_SECRET || 'pizza-submissions';
  return crypto.createHash('sha256').update(`${ip ?? 'unknown'}|${secret}`).digest('hex');
}

/** Detect the real type from the first bytes. Returns an ALLOWED_MIME key or null. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

const PATH_RE = /^(anon|[A-Za-z0-9_-]{1,64})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$/;

/** `{userId|anon}/{uuid}.{ext}`; the folder must match the caller (anonymous callers use `anon/`). */
export function isValidStoragePath(path: unknown, userId: string | null): path is string {
  if (typeof path !== 'string' || path.length > 200) return false;
  const m = PATH_RE.exec(path);
  if (!m) return false;
  return m[1] === (userId ?? 'anon');
}

export function makeStoragePath(userId: string | null, mime: string): string {
  const ext = ALLOWED_MIME[mime];
  return `${userId ?? 'anon'}/${crypto.randomUUID()}.${ext}`;
}

/** Latest "today" anywhere on earth (UTC+14), so a receipt from today in Kiribati is not "future". */
export function maxReceiptDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface SubmissionFields {
  path: string;
  receiptDate: string;
  year: number;
  merchant: string;
  city: string | null;
  country: string;
  countryCode: string | null;
  region: string | null;
  sizeNote: string | null;
  email: string | null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = sanitizePgString(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function validateReceiptDate(date: unknown, now: Date = new Date()): string {
  if (!isValidIsoDate(date)) throw new AppError('Receipt date must be a valid date', 400, 'BAD_DATE');
  if (date < SUBMISSION_FIRST_DATE) throw new AppError(`Receipts must be dated ${SUBMISSION_FIRST_DATE} or later`, 400, 'DATE_TOO_OLD');
  if (date > maxReceiptDate(now)) throw new AppError('Receipt date cannot be in the future', 400, 'DATE_IN_FUTURE');
  return date;
}

export function canonicalLocation(countryIn: unknown): { country: string; countryCode: string | null; region: string | null } {
  const raw = clean(countryIn, 80);
  const country = canonicalizeCountryName(raw);
  if (!raw || !country) throw new AppError('Please pick a city so we know the country', 400, 'BAD_COUNTRY');
  const code = getCountryCode(country);
  return { country, countryCode: code, region: (code ? countryCodeToRegion(code) : null) ?? countryNameToRegion(country) };
}

/** Validate the POST / body (everything except the file bytes). Throws AppError(400). */
export function validateSubmissionFields(body: Record<string, unknown>, userId: string | null, now: Date = new Date()): SubmissionFields {
  if (!isValidStoragePath(body.path, userId)) throw new AppError('Invalid upload path', 400, 'BAD_PATH');
  const receiptDate = validateReceiptDate(body.receiptDate, now);
  const merchant = clean(body.merchant, 120);
  if (!merchant) throw new AppError('Pizzeria name is required', 400, 'MERCHANT_REQUIRED');
  const loc = canonicalLocation(body.country);
  const sizeNoteRaw = typeof body.sizeNote === 'string' ? body.sizeNote : '';
  if (sizeNoteRaw.length > 200) throw new AppError('Size note is too long (200 characters max)', 400, 'SIZE_NOTE_TOO_LONG');
  let email: string | null = null;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    email = clean(body.email, 254)?.toLowerCase() ?? null;
    if (!email || !EMAIL_RE.test(email)) throw new AppError('That email does not look right', 400, 'BAD_EMAIL');
  }
  return {
    path: body.path,
    receiptDate,
    year: Number(receiptDate.slice(0, 4)),
    merchant,
    city: clean(body.city, 120),
    ...loc,
    sizeNote: clean(sizeNoteRaw, 200),
    email,
  };
}

// ---------------------------------------------------------------------------
// Public flow
// ---------------------------------------------------------------------------

export async function assertQueueHasRoom(): Promise<void> {
  const pending = await prisma.pizzaSubmission.count({ where: { status: 'pending' } });
  if (pending >= LIMITS.globalPending) {
    throw new AppError('We have a lot of receipts waiting for review right now. Please try again later.', 503, 'QUEUE_FULL');
  }
}

export async function assertIpWithinLimits(ipHash: string, now: Date = new Date()): Promise<void> {
  const [hour, day] = await Promise.all([
    prisma.pizzaSubmission.count({ where: { ipHash, createdAt: { gte: new Date(now.getTime() - 3600_000) } } }),
    prisma.pizzaSubmission.count({ where: { ipHash, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  if (hour >= LIMITS.perHour) throw new AppError('Too many receipts from your connection this hour. Please try again later.', 429, 'RATE_LIMITED');
  if (day >= LIMITS.perDay) throw new AppError('Too many receipts from your connection today. Please try again tomorrow.', 429, 'RATE_LIMITED');
}

export async function createUploadUrl(userId: string | null, mimeType: unknown, fileSize: unknown): Promise<{ path: string; token: string }> {
  if (typeof mimeType !== 'string' || !ALLOWED_MIME[mimeType]) {
    throw new AppError('Please upload a JPEG, PNG, WebP, HEIC or PDF', 400, 'BAD_FILE_TYPE');
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) throw new AppError('Missing file size', 400, 'BAD_FILE_SIZE');
  if (fileSize > MAX_FILE_BYTES) throw new AppError('That file is too big (10 MB max)', 413, 'FILE_TOO_BIG');
  await assertQueueHasRoom();
  const path = makeStoragePath(userId, mimeType);
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new AppError('Could not start the upload. Please try again.', 502, 'UPLOAD_URL_FAILED');
  return { path, token: data.token };
}

export interface FinalizeInput {
  userId: string | null;
  userEmail: string | null;
  body: Record<string, unknown>;
  ip: string | undefined;
}

/** Validate, verify the uploaded object, and insert a `pending` row. */
export async function finalizeSubmission(input: FinalizeInput): Promise<{ id: string; status: 'pending' }> {
  const f = validateSubmissionFields(input.body, input.userId);
  const ipHash = hashIp(input.ip);
  await assertIpWithinLimits(ipHash);
  await assertQueueHasRoom();

  const { data: blob, error: dlErr } = await bucket().download(f.path);
  if (dlErr || !blob) throw new AppError('We could not find your uploaded file. Please try again.', 400, 'FILE_MISSING');
  const buf = Buffer.from(await blob.arrayBuffer());
  const discard = async () => { await bucket().remove([f.path]).catch(() => undefined); };
  if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
    await discard();
    throw new AppError('That file is too big (10 MB max)', 413, 'FILE_TOO_BIG');
  }
  const mime = sniffMime(buf);
  const expectedExt = f.path.split('.').pop();
  if (!mime || ALLOWED_MIME[mime] !== expectedExt) {
    await discard();
    throw new AppError('That file does not look like a JPEG, PNG, WebP, HEIC or PDF', 400, 'BAD_FILE_TYPE');
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = await prisma.pizzaSubmission.findUnique({ where: { fileSha256: sha }, select: { id: true } });
  if (existing) {
    await discard();
    throw new AppError('This receipt was already submitted. Thank you!', 409, 'ALREADY_SUBMITTED');
  }

  // Soft duplicate flag (never blocks): same pizzeria within a day of the same date.
  const merchantKey = normalizeMerchantKey(f.merchant);
  let duplicateOfId: string | null = null;
  let duplicateReason: string | null = null;
  if (merchantKey) {
    const d = new Date(`${f.receiptDate}T00:00:00Z`);
    const dup = await prisma.pizzaSubmission.findFirst({
      where: {
        merchantKey,
        receiptDate: { gte: new Date(d.getTime() - 86_400_000), lte: new Date(d.getTime() + 86_400_000) },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (dup) { duplicateOfId = dup.id; duplicateReason = 'same pizzeria within 1 day of this date'; }
  }

  try {
    const row = await prisma.pizzaSubmission.create({
      data: {
        status: 'pending',
        submitterUserId: input.userId,
        submitterEmail: f.email ?? input.userEmail,
        notify: !!f.email,
        storagePath: f.path,
        mimeType: mime,
        fileSize: buf.length,
        fileSha256: sha,
        receiptDate: new Date(`${f.receiptDate}T00:00:00Z`),
        year: f.year,
        country: f.country,
        countryCode: f.countryCode,
        city: f.city,
        region: f.region,
        merchant: f.merchant,
        merchantKey,
        sizeNote: f.sizeNote,
        duplicateOfId,
        duplicateReason,
        ipHash,
      },
      select: { id: true },
    });
    return { id: row.id, status: 'pending' };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await discard();
      throw new AppError('This receipt was already submitted. Thank you!', 409, 'ALREADY_SUBMITTED');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Admin: DTOs, list, OCR, approve, reject
// ---------------------------------------------------------------------------

type DbSubmission = Prisma.PizzaSubmissionGetPayload<object>;

export interface SubmissionDto {
  id: string;
  status: string;
  createdAt: string;
  submitterEmail: string | null;
  submittedByUser: boolean;
  notify: boolean;
  /** Short-lived signed URLs (admin only). */
  receiptUrl: string | null;
  /** PNG of page 1 for PDFs (after "Read receipt"), else null. */
  previewUrl: string | null;
  mimeType: string;
  receiptDate: string;
  year: number;
  country: string;
  city: string | null;
  merchant: string;
  sizeNote: string | null;
  kind: string | null;
  currency: string | null;
  total: number | null;
  pizzaCount: number | null;
  fxRate: number | null;
  fxSource: string | null;
  ocr: OcrResult | null;
  ocrAt: string | null;
  duplicateOfId: string | null;
  duplicateReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return error || !data ? null : data.signedUrl;
}
const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export async function toSubmissionDto(r: DbSubmission): Promise<SubmissionDto> {
  const [receiptUrl, previewUrl] = await Promise.all([signed(r.storagePath), signed(r.ocrImagePath)]);
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    submitterEmail: r.submitterEmail,
    submittedByUser: !!r.submitterUserId,
    notify: r.notify,
    receiptUrl,
    previewUrl,
    mimeType: r.mimeType,
    receiptDate: r.receiptDate.toISOString().slice(0, 10),
    year: r.year,
    country: r.country,
    city: r.city,
    merchant: r.merchant,
    sizeNote: r.sizeNote,
    kind: r.kind,
    currency: r.currency,
    total: num(r.total),
    pizzaCount: num(r.pizzaCount),
    fxRate: num(r.fxRate),
    fxSource: r.fxSource,
    ocr: (r.ocrRaw as unknown as OcrResult | null) ?? null,
    ocrAt: r.ocrAt ? r.ocrAt.toISOString() : null,
    duplicateOfId: r.duplicateOfId,
    duplicateReason: r.duplicateReason,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    rejectReason: r.rejectReason,
  };
}

export async function listSubmissions(status: string, limit: number, offset: number): Promise<{ total: number; submissions: SubmissionDto[] }> {
  const where = status === 'all' ? {} : { status };
  const [total, rows] = await Promise.all([
    prisma.pizzaSubmission.count({ where }),
    prisma.pizzaSubmission.findMany({ where, orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' }, take: limit, skip: offset }),
  ]);
  return { total, submissions: await Promise.all(rows.map(toSubmissionDto)) };
}

export async function getSubmission(id: string): Promise<SubmissionDto> {
  const r = await prisma.pizzaSubmission.findUnique({ where: { id } });
  if (!r) throw new AppError('Submission not found', 404, 'NOT_FOUND');
  return toSubmissionDto(r);
}

export async function submissionCounts(): Promise<Record<'pending' | 'approved' | 'rejected', number>> {
  const rows = await prisma.pizzaSubmission.groupBy({ by: ['status'], _count: { _all: true } });
  const out = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) if (r.status in out) out[r.status as keyof typeof out] = r._count._all;
  return out;
}

export interface SubmissionDraft {
  kind: HistoryKind;
  currency: string | null;
  total: number | null;
  pizzaCount: number | null;
  merchant: string | null;
  receiptDate: string | null;
  lines: Array<{ name: string; qty: number; unitPrice: number; sizeLabel: string | null; diameterCm: number | null }>;
}

/** Prefill for the admin form from an OCR result (pizza lines only). */
export function ocrToDraft(ocr: OcrResult): SubmissionDraft {
  const lines = (ocr.lineItems ?? [])
    .filter((l) => l.category === 'pizza')
    .map((l) => ({
      name: l.name, qty: l.qty, unitPrice: l.unitPrice,
      sizeLabel: l.size?.label ?? null, diameterCm: l.size?.diameterCm ?? null,
    }));
  return {
    kind: lines.length ? 'itemized' : 'lump_sum',
    currency: ocr.currency,
    total: ocr.amount > 0 ? ocr.amount : null,
    pizzaCount: ocr.pizzaCount ?? null,
    merchant: ocr.merchant ?? null,
    receiptDate: ocr.receiptDate ?? null,
    lines,
  };
}

/** OCR on admin open only (spam costs nothing until a human looks). */
export async function extractSubmission(id: string): Promise<{ submission: SubmissionDto; draft: SubmissionDraft | null }> {
  const sub = await prisma.pizzaSubmission.findUnique({ where: { id } });
  if (!sub) throw new AppError('Submission not found', 404, 'NOT_FOUND');
  let imagePath = sub.storagePath;
  let ocrImagePath = sub.ocrImagePath;
  if (sub.mimeType === 'application/pdf') {
    if (!ocrImagePath) {
      const { data, error } = await bucket().download(sub.storagePath);
      if (error || !data) throw new AppError('Could not read the stored file', 502, 'FILE_MISSING');
      const { pngBuffer } = await rasterizePdfFirstPage(Buffer.from(await data.arrayBuffer()));
      ocrImagePath = `${sub.storagePath}.thumb.png`;
      const up = await bucket().upload(ocrImagePath, pngBuffer, { contentType: 'image/png', upsert: true });
      if (up.error) throw new AppError('Could not render the PDF', 502, 'PDF_RENDER_FAILED');
    }
    imagePath = ocrImagePath;
  }
  const url = await signed(imagePath);
  if (!url) throw new AppError('Could not read the stored file', 502, 'FILE_MISSING');
  const results = await analyzeReceiptMulti({ imageUrl: url, partyCountry: sub.country });
  const first = results[0] ?? null;
  await prisma.pizzaSubmission.update({
    where: { id },
    data: {
      ocrImagePath,
      ocrRaw: first ? (JSON.parse(JSON.stringify(first)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      ocrAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return { submission: await getSubmission(id), draft: first ? ocrToDraft(first) : null };
}

// --- FX ---------------------------------------------------------------------

const DAY = 86_400_000;
export interface SubmissionFx { rate: number; source: string; date: string }

/**
 * USD per 1 unit of `currency` for the receipt date. Recent receipts (<= 30 days) use the live
 * rate; older ones use Frankfurter (ECB) for that date. Never falls back to the 2026 constants:
 * when no real rate exists the admin must enter one (`fxRate` on the draft).
 */
export async function getSubmissionFx(currency: string, receiptDate: string, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<SubmissionFx> {
  const cur = currency.trim().toUpperCase();
  if (cur === 'USD') return { rate: 1, source: 'usd-passthrough', date: receiptDate };
  const ageMs = now.getTime() - new Date(`${receiptDate}T00:00:00Z`).getTime();
  if (ageMs <= 30 * DAY) {
    const r = await convertToUSD(1, cur);
    if (r.exchangeRate && (r.source === 'jsdelivr' || r.source === 'frankfurter')) {
      return { rate: r.exchangeRate, source: r.source, date: now.toISOString().slice(0, 10) };
    }
  } else {
    try {
      const res = await fetchImpl(`https://api.frankfurter.dev/v1/${receiptDate}?base=${cur}&symbols=USD`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const j = (await res.json()) as { rates?: { USD?: number }; date?: string };
        const rate = Number(j?.rates?.USD);
        if (rate > 0 && Number.isFinite(rate)) {
          const d = typeof j.date === 'string' && isValidIsoDate(j.date) ? j.date : receiptDate;
          return { rate, source: `frankfurter:${d}`, date: d };
        }
      }
    } catch { /* fall through */ }
  }
  throw new AppError(`No exchange rate for ${cur} on ${receiptDate}. Enter one manually.`, 422, 'FX_UNAVAILABLE');
}

// --- Approve / reject ---------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MAX_LINES = 60;

export interface ParsedDraft {
  kind: HistoryKind;
  currency: string | null;
  total: number | null;
  pizzaCount: number | null;
  merchant: string | null;
  city: string | null;
  country: string | null;
  receiptDate: string | null;
  fxRate: number | null;
  lines: HistoryLineIn[];
}

/** Validate the admin-edited draft body of POST /submissions/:id/approve. */
export function parseDraft(body: unknown): ParsedDraft {
  if (!isObj(body)) throw new AppError('Draft is required', 400, 'BAD_DRAFT');
  const kind = body.kind;
  if (kind !== 'itemized' && kind !== 'lump_sum' && kind !== 'not_pizza') throw new AppError('kind must be itemized, lump_sum or not_pizza', 400, 'BAD_DRAFT');
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : null;
  if (kind !== 'not_pizza' && !(currency && /^[A-Z]{3}$/.test(currency))) throw new AppError('A 3-letter currency code is required', 400, 'BAD_CURRENCY');
  const total = numOrNull(body.total);
  const pizzaCount = numOrNull(body.pizzaCount);
  if (kind === 'lump_sum' && !(total && total > 0 && pizzaCount && pizzaCount > 0)) {
    throw new AppError('A lump-sum receipt needs a total and a pizza count', 400, 'BAD_DRAFT');
  }
  const linesRaw = Array.isArray(body.lines) ? body.lines : [];
  if (linesRaw.length > MAX_LINES) throw new AppError(`At most ${MAX_LINES} lines`, 400, 'BAD_DRAFT');
  const lines: HistoryLineIn[] = [];
  for (const l of linesRaw) {
    if (!isObj(l)) throw new AppError('Bad line', 400, 'BAD_DRAFT');
    const qty = numOrNull(l.qty);
    const unitPrice = numOrNull(l.unitPrice);
    if (qty === null || unitPrice === null || qty < 0 || unitPrice < 0 || qty > 9999 || unitPrice > 10_000_000) {
      throw new AppError('Every line needs a sensible quantity and unit price', 400, 'BAD_DRAFT');
    }
    lines.push({
      name: clean(l.name, 200) ?? '[illegible]', qty, unitPrice,
      sizeLabel: clean(l.sizeLabel, 40), diameterCm: numOrNull(l.diameterCm), category: 'pizza',
      isBundle: l.isBundle === true,
    });
  }
  if (kind === 'itemized' && lines.length === 0) throw new AppError('Add at least one pizza line', 400, 'BAD_DRAFT');
  const fxRate = numOrNull(body.fxRate);
  if (fxRate !== null && !(fxRate > 0)) throw new AppError('Exchange rate must be positive', 400, 'BAD_DRAFT');
  return {
    kind, currency, total, pizzaCount, lines, fxRate,
    merchant: clean(body.merchant, 120),
    city: clean(body.city, 120),
    country: clean(body.country, 80),
    receiptDate: typeof body.receiptDate === 'string' ? body.receiptDate : null,
  };
}

export interface ApproveResult {
  submission: SubmissionDto;
  linesWritten: number;
  /** e.g. 'no_size': no line has a resolved size yet, so nothing counts until it is sized in Review. */
  warnings: string[];
}

export async function approveSubmission(id: string, actorEmail: string, bodyIn: unknown): Promise<ApproveResult> {
  const draft = parseDraft(bodyIn);
  const sub = await prisma.pizzaSubmission.findUnique({ where: { id } });
  if (!sub) throw new AppError('Submission not found', 404, 'NOT_FOUND');
  if (sub.status !== 'pending') throw new AppError(`Already ${sub.status}`, 409, 'NOT_PENDING');

  const receiptDate = draft.receiptDate ? validateReceiptDate(draft.receiptDate) : sub.receiptDate.toISOString().slice(0, 10);
  const loc = draft.country ? canonicalLocation(draft.country) : { country: sub.country, countryCode: sub.countryCode, region: sub.region };
  const merchant = draft.merchant ?? sub.merchant;
  const city = draft.city ?? sub.city;
  const year = Number(receiptDate.slice(0, 4));
  const merchantKey = normalizeMerchantKey(merchant);
  const now = new Date();

  let fx: SubmissionFx | null = null;
  if (draft.kind !== 'not_pizza') {
    fx = draft.fxRate
      ? { rate: draft.fxRate, source: 'manual', date: receiptDate }
      : await getSubmissionFx(draft.currency!, receiptDate);
  }

  const record: HistoryRecord = {
    year, country: loc.country, city, merchant, receiptDate, currency: draft.currency ?? 'USD',
    sourceFileId: id, sourceTitle: null, sourceUrl: null,
    total: draft.total, kind: draft.kind, pizzaCount: draft.pizzaCount,
    // The submitter's size note is only a hint for lines that carry no printed size.
    lines: draft.lines.map((l) => ({ ...l, sizeLabel: l.sizeLabel ?? sub.sizeNote })),
    sizeLabel: sub.sizeNote,
  };
  const built = fx ? buildHistoryLines(record, await loadPresets(), fx.rate, loc.country) : [];

  await prisma.$transaction([
    prisma.pizzaLineItem.deleteMany({ where: { submissionId: id } }),
    prisma.pizzaSubmission.update({
      where: { id },
      data: {
        status: 'approved', kind: draft.kind, currency: draft.currency, total: draft.total, pizzaCount: draft.pizzaCount,
        merchant, merchantKey, city, country: loc.country, countryCode: loc.countryCode, region: loc.region,
        receiptDate: new Date(`${receiptDate}T00:00:00Z`), year,
        fxRate: fx?.rate ?? null, fxSource: fx?.source ?? null, fxDate: fx ? new Date(`${fx.date}T00:00:00Z`) : null,
        reviewedBy: actorEmail, reviewedAt: now, rejectReason: null, updatedAt: now,
      },
    }),
    // updated_by MUST be set: markDuplicateLines resets duplicate_line rows with updated_by NULL.
    prisma.pizzaLineItem.createMany({
      data: built.map((l) => ({ ...l, submissionId: id, updatedBy: actorEmail })),
    }),
  ]);
  invalidatePizzaIndexCache();
  await refreshOutliers(0).catch(() => undefined);

  const warnings: string[] = [];
  if (built.length > 0 && !built.some((l) => !l.excluded && (l.areaCm2 ?? 0) > 0)) warnings.push('no_size');
  return { submission: await getSubmission(id), linesWritten: built.length, warnings };
}

export async function rejectSubmission(id: string, actorEmail: string, reason: unknown): Promise<SubmissionDto> {
  const sub = await prisma.pizzaSubmission.findUnique({ where: { id }, select: { id: true } });
  if (!sub) throw new AppError('Submission not found', 404, 'NOT_FOUND');
  const now = new Date();
  await prisma.$transaction([
    prisma.pizzaLineItem.deleteMany({ where: { submissionId: id } }),
    prisma.pizzaSubmission.update({
      where: { id },
      data: { status: 'rejected', rejectReason: clean(reason, 300), reviewedBy: actorEmail, reviewedAt: now, updatedAt: now },
    }),
  ]);
  invalidatePizzaIndexCache();
  return getSubmission(id);
}
