/**
 * salame-92110: storage helpers for host tax-form PDFs.
 *
 * SECURITY (salame-92110 fix): tax-form PDFs contain SSN/EIN + signatures and
 * MUST NOT live in a public bucket. They are uploaded to the PRIVATE `tax-forms`
 * bucket and only ever surfaced through short-lived signed URLs minted per
 * request. The stored `tax_forms.pdf_url` column holds the bucket-relative
 * object PATH (not a URL); the route layer mints a signed URL from it at read
 * time via `getSignedTaxFormUrl`.
 *
 * Path: `{userId}/{formType}-{timestamp}.pdf` inside the `tax-forms` bucket.
 *
 * Thumbnails: phase 1 skips server-side PDF→PNG rendering. The admin reviewer
 * modal renders the PDF itself via <embed> against a signed URL.
 */
import { createClient } from '@supabase/supabase-js';

/** PRIVATE bucket — created via ensureBucket() below (public: false). */
const BUCKET = 'tax-forms';

/** Signed-URL lifetime. Long enough for an admin review session / host view,
 *  short enough that a leaked URL expires quickly. Minted fresh on each read. */
const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 minutes

let _client: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to upload tax forms');
  }
  _client = createClient(url, key);
  return _client;
}

let _bucketEnsured = false;
/**
 * Idempotently ensure the private `tax-forms` bucket exists with a PDF-only
 * allowlist and 10MB cap. Safe to call repeatedly — an "already exists" error
 * is treated as success. (Project convention creates buckets via the dashboard;
 * this keeps the private bucket self-healing across environments.)
 */
async function ensureBucket(supabase: ReturnType<typeof createClient>) {
  if (_bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    allowedMimeTypes: ['application/pdf'],
    fileSizeLimit: '10MB',
  });
  if (error && !/already exists|resource already exists/i.test(error.message)) {
    throw new Error(`Failed to ensure private tax-forms bucket: ${error.message}`);
  }
  _bucketEnsured = true;
}

export type TaxFormType = 'w9' | 'w8ben' | 'w8bene';

export interface UploadTaxFormPdfResult {
  /** Bucket-relative object path — store this in tax_forms.pdf_url. */
  path: string;
  /** Currently null — phase 1 skips thumbnail generation (PDF embed used). */
  thumbPath: string | null;
}

/**
 * Upload a generated tax-form PDF buffer to the PRIVATE tax-forms bucket and
 * return its object path (to be persisted in tax_forms.pdf_url). Throws on
 * upload failure.
 */
export async function uploadTaxFormPdf(
  buffer: Buffer,
  userId: string,
  formType: TaxFormType,
): Promise<UploadTaxFormPdfResult> {
  const supabase = getSupabaseAdmin();
  await ensureBucket(supabase);
  const ts = Date.now();
  const path = `${userId}/${formType}-${ts}.pdf`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'application/pdf',
    });

  if (error) {
    throw new Error(`Tax form PDF upload failed: ${error.message}`);
  }

  return {
    path,
    thumbPath: null,
  };
}

/**
 * Normalize a stored pdf_url value to a bucket-relative object path.
 * New rows store a bare path already. Be defensive about any legacy full URL
 * that points at this bucket (post-backfill this branch is unused).
 */
function toObjectPath(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  // e.g. https://<proj>.supabase.co/storage/v1/object/(public|sign)/tax-forms/<path>?...
  const m = value.match(/\/object\/(?:public|sign|authenticated)\/tax-forms\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Mint a short-lived signed URL for a stored tax-form object path. Returns null
 * for empty/unresolvable values so callers can surface `pdfUrl: null` cleanly
 * rather than leaking a broken link.
 */
export async function getSignedTaxFormUrl(
  pathOrUrl: string | null | undefined,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!pathOrUrl) return null;
  const path = toObjectPath(pathOrUrl);
  if (!path) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
