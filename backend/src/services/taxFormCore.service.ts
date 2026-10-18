/**
 * Shared tax-form draft/submit core (calzone-70821). Extracted from
 * tax-form.routes.ts so both the authed host API (owner = userId) and the
 * public token API (owner = requestId) use identical validation + PDF logic.
 * NEVER log formData (contains TINs).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import {
  generateW9PDF,
  generateW8BENPDF,
  generateW8BENEPDF,
  W9FormData,
  W8BENFormData,
  W8BENEFormData,
} from './taxFormPdf.service.js';
import { uploadTaxFormPdf, TaxFormType } from './taxFormStorage.service.js';

const FORM_TYPES: ReadonlyArray<TaxFormType> = ['w9', 'w8ben', 'w8bene'] as const;

export function isValidFormType(v: unknown): v is TaxFormType {
  return typeof v === 'string' && (FORM_TYPES as ReadonlyArray<string>).includes(v);
}

/** Sensitive keys: preserved server-side when a payload omits/blanks them. */
export const SECRET_KEYS = ['ssn', 'ein', 'tin', 'itin', 'usTin', 'foreignTin', 'giin', 'dateOfBirth', 'accountNumbers', 'referenceNumbers'];

/**
 * Keys the public token API never returns: every SECRET_KEY plus the typed
 * signature (the payee re-signs on each submit, see submitTaxFormCore).
 */
export const PUBLIC_REDACTED_KEYS: ReadonlyArray<string> = [...SECRET_KEYS, 'signature'];

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim());
}

/** Names (never values) of SECRET_KEYS that hold a non-blank value in `data`. */
export function storedSecretFieldNames(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  return SECRET_KEYS.filter((k) => !isBlank(d[k]));
}

/** Copy of `data` with every PUBLIC_REDACTED_KEYS entry removed. */
export function redactForPublic(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!PUBLIC_REDACTED_KEYS.includes(k)) out[k] = v;
    }
  }
  return out;
}

/**
 * Merge incoming over existing, but keep stored values for secret keys the
 * payload omits or leaves blank (public draft GET never returns them).
 */
export function mergePreservingSecrets(existing: any, incoming: any): Record<string, any> {
  const out: Record<string, any> = { ...(existing || {}), ...(incoming || {}) };
  for (const k of SECRET_KEYS) {
    if (isBlank(incoming?.[k]) && existing && existing[k] !== undefined) out[k] = existing[k];
  }
  // W-9 SSN and EIN are mutually exclusive: a newly entered one replaces the
  // stored other instead of both ending up on the PDF.
  if (!isBlank(incoming?.ssn) && isBlank(incoming?.ein)) delete out.ein;
  if (!isBlank(incoming?.ein) && isBlank(incoming?.ssn)) delete out.ssn;
  return out;
}

/** Who owns the form. At least one of userId / requestId must be set. */
export interface TaxFormOwner {
  userId?: string | null;
  requestId?: string | null;
  /** Audit trail, recorded with signed_at on submit (request flow). */
  signerIp?: string | null;
  signerUserAgent?: string | null;
}

/**
 * Request-owned (token) forms must NEVER carry a user_id: the token proves
 * possession of a link, not identity, and linking would surface the form in
 * that user's /api/tax-forms/me and payout gate. Refuse rather than silently
 * drop so a caller bug is loud.
 */
function assertOwner(owner: TaxFormOwner): void {
  if (owner.requestId && owner.userId) {
    throw new AppError('Tax form owner conflict', 500, 'OWNER_CONFLICT');
  }
}

/** user_id to write on CREATE. Always null for request-owned forms. */
function ownerUserId(owner: TaxFormOwner): string | null {
  return owner.requestId ? null : owner.userId ?? null;
}

function ownerWhere(owner: TaxFormOwner): Prisma.TaxFormWhereInput {
  if (owner.requestId) return { requestId: owner.requestId };
  if (owner.userId) return { userId: owner.userId, requestId: null };
  throw new AppError('Tax form owner missing', 500, 'NO_OWNER');
}

function storageKey(owner: TaxFormOwner): string {
  return owner.requestId ? `requests/${owner.requestId}` : (owner.userId as string);
}

/**
 * Validate the minimal required fields per form type before generating a PDF.
 * Throws AppError(400, 'INVALID_FORM_DATA') with a human-readable message
 * naming the missing field.
 */
export function assertSubmitValid(formType: TaxFormType, data: any): void {
  function requireField(field: string) {
    if (!data || typeof data[field] !== 'string' || !data[field].trim()) {
      throw new AppError(
        `Missing required field: ${field}`,
        400,
        'INVALID_FORM_DATA',
      );
    }
  }
  if (formType === 'w9') {
    requireField('name');
    requireField('taxClassification');
    requireField('address');
    // prosciutto-92107: accept either the new structured fields (city + state
    // + zipCode) or the legacy combined cityStateZip field. New form submits
    // populate the structured fields; older drafts pre-dating this change
    // still validate via the legacy fallback so the host can submit their
    // saved draft without re-typing.
    const hasStructured =
      typeof data.city === 'string' && data.city.trim()
      && typeof data.state === 'string' && data.state.trim()
      && typeof data.zipCode === 'string' && data.zipCode.trim();
    if (!hasStructured) {
      requireField('cityStateZip');
    }
    requireField('signature');
    requireField('date');
    // Exactly one of SSN / EIN must be present.
    const hasSsn = typeof data.ssn === 'string' && data.ssn.trim();
    const hasEin = typeof data.ein === 'string' && data.ein.trim();
    if (!hasSsn && !hasEin) {
      throw new AppError(
        'Either SSN or EIN is required on the W-9',
        400,
        'INVALID_FORM_DATA',
      );
    }
  } else if (formType === 'w8ben') {
    requireField('name');
    requireField('citizenship');
    requireField('permanentAddress');
    requireField('permanentCity');
    requireField('permanentCountry');
    requireField('dateOfBirth');
    requireField('signature');
    requireField('date');
  } else if (formType === 'w8bene') {
    requireField('entityName');
    requireField('countryOfIncorporation');
    requireField('entityType');
    requireField('chapter4Status');
    requireField('permanentAddress');
    requireField('permanentCity');
    requireField('permanentCountry');
    requireField('signature');
    requireField('date');
    if (data.chapter4Status === 'ffi') {
      // FFI requires the long-form FATCA classification we don't render.
      throw new AppError(
        'FFI entities require a paper W-8BEN-E — please contact an admin',
        400,
        'FFI_PAPER_FORM_REQUIRED',
      );
    }
  }
}

/**
 * Compute the IRS expiry for a W-8 form: signed_at + 3 years and the rest of
 * the calendar year. Simplified to "signed_at + 3 years 11 months" — phase 2
 * cron refines this if needed.
 *
 * W-9 has no expiry (returns null).
 */
export function computeExpiry(formType: TaxFormType, signedAt: Date): Date | null {
  if (formType === 'w9') return null;
  const d = new Date(signedAt);
  d.setUTCMonth(d.getUTCMonth() + 47); // 3 years 11 months
  return d;
}


export async function saveTaxFormDraftCore(
  owner: TaxFormOwner,
  formType: TaxFormType,
  formData: unknown,
) {
  assertOwner(owner);
  if (formData == null || typeof formData !== 'object') {
    throw new AppError('formData must be an object', 400, 'INVALID_FORM_DATA');
  }
  // Update an existing draft in place so editing doesn't pile up rows.
  const existingDraft = await prisma.taxForm.findFirst({
    where: { ...ownerWhere(owner), formType, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  });
  const data = formData as Prisma.InputJsonValue;
  if (existingDraft) {
    const merged = (owner.requestId
      ? mergePreservingSecrets(existingDraft.formData, formData)
      : formData) as Prisma.InputJsonValue;
    // Conditional on still being a draft, so a concurrent submit that already
    // finalised this row is never overwritten. Owner columns are never touched.
    const upd = await prisma.taxForm.updateMany({
      where: { id: existingDraft.id, status: 'draft' },
      data: { formData: merged },
    });
    if (upd.count === 0) {
      throw new AppError(
        'This form has already been submitted.',
        409,
        owner.requestId ? 'TOKEN_LOCKED' : 'ALREADY_SUBMITTED',
      );
    }
    const row = await prisma.taxForm.findUnique({ where: { id: existingDraft.id } });
    if (!row) throw new AppError('Tax form not found', 404, 'NOT_FOUND');
    return { row, created: false };
  }
  const row = await prisma.taxForm.create({
    data: {
      userId: ownerUserId(owner),
      requestId: owner.requestId ?? null,
      formType,
      status: 'draft',
      formData: data,
    },
  });
  return { row, created: true };
}

export async function submitTaxFormCore(
  owner: TaxFormOwner,
  formType: TaxFormType,
  formData: unknown,
) {
  assertOwner(owner);
  // Token flow: the payee must type the signature on every submit (the public
  // GET never returns it), so a stored draft signature never counts as signing.
  if (owner.requestId && isBlank((formData as any)?.signature)) {
    throw new AppError('Missing required field: signature', 400, 'INVALID_FORM_DATA');
  }
  const draft = await prisma.taxForm.findFirst({
    where: { ...ownerWhere(owner), formType, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  });

  const dataToValidate = formData && typeof formData === 'object'
    ? (owner.requestId
        ? mergePreservingSecrets(draft?.formData, formData)
        : { ...((draft?.formData as any) || {}), ...(formData as any) })
    : ((draft?.formData as any) || {});

  assertSubmitValid(formType, dataToValidate);

  const refIdForPdf = draft?.id || `${formType}-${Date.now()}`;
  let pdf: Buffer;
  if (formType === 'w9') {
    pdf = await generateW9PDF(dataToValidate as W9FormData, refIdForPdf.slice(0, 8));
  } else if (formType === 'w8ben') {
    pdf = await generateW8BENPDF(dataToValidate as W8BENFormData, refIdForPdf.slice(0, 8));
  } else {
    pdf = await generateW8BENEPDF(dataToValidate as W8BENEFormData, refIdForPdf.slice(0, 8));
  }

  // PRIVATE bucket; persist the object PATH, mint signed URLs on read.
  const { path, thumbPath } = await uploadTaxFormPdf(pdf, storageKey(owner), formType);

  const now = new Date();
  const expiresAt = computeExpiry(formType, now);
  const audit = owner.requestId
    ? {
        signerIp: owner.signerIp ? owner.signerIp.slice(0, 64) : null,
        signerUserAgent: owner.signerUserAgent ? owner.signerUserAgent.slice(0, 512) : null,
      }
    : {};
  if (draft) {
    return prisma.taxForm.update({
      where: { id: draft.id },
      data: {
        formData: dataToValidate as Prisma.InputJsonValue,
        status: 'submitted',
        pdfUrl: path,
        pdfThumbUrl: thumbPath,
        signedAt: now,
        expiresAt,
        rejectedReason: null,
        ...audit,
      },
    });
  }
  return prisma.taxForm.create({
    data: {
      userId: ownerUserId(owner),
      requestId: owner.requestId ?? null,
      formType,
      status: 'submitted',
      formData: dataToValidate as Prisma.InputJsonValue,
      pdfUrl: path,
      pdfThumbUrl: thumbPath,
      signedAt: now,
      expiresAt,
      ...audit,
    },
  });
}

/**
 * Mirror a tax form's verified/rejected status onto its request (if any).
 * No-op for forms without a request.
 */
export async function mirrorRequestStatus(taxFormId: string, status: 'verified' | 'rejected') {
  await prisma.taxFormRequest.updateMany({
    where: { taxFormId },
    data: { status },
  });
}
