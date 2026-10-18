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

/** Who owns the form. At least one of userId / requestId must be set. */
export interface TaxFormOwner {
  userId?: string | null;
  requestId?: string | null;
  /** Audit trail, recorded with signed_at on submit (request flow). */
  signerIp?: string | null;
  signerUserAgent?: string | null;
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
    const row = await prisma.taxForm.update({
      where: { id: existingDraft.id },
      data: { formData: data, ...(owner.userId ? { userId: owner.userId } : {}) },
    });
    return { row, created: false };
  }
  const row = await prisma.taxForm.create({
    data: {
      userId: owner.userId ?? null,
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
  const draft = await prisma.taxForm.findFirst({
    where: { ...ownerWhere(owner), formType, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  });

  const dataToValidate = formData && typeof formData === 'object'
    ? { ...((draft?.formData as any) || {}), ...(formData as any) }
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
        ...(owner.userId ? { userId: owner.userId } : {}),
        ...audit,
      },
    });
  }
  return prisma.taxForm.create({
    data: {
      userId: owner.userId ?? null,
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
