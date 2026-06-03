/**
 * salame-92110: storage helpers for host tax-form PDFs.
 *
 * PDFs are uploaded to the existing `event-images` Supabase Storage bucket
 * (10MB cap + application/pdf allowlist already in place from bocconcino-92104).
 * Path: `tax-forms/{userId}/{formType}-{timestamp}.pdf`.
 *
 * Thumbnails: phase 1 skips server-side PDF→PNG rendering. We surface the
 * PDF URL directly; the admin reviewer modal renders it via <embed>. A future
 * iteration can add `pdfjs-dist` to the backend if a real thumbnail becomes
 * necessary — for the foundational PR that's overkill.
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'event-images';

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

export type TaxFormType = 'w9' | 'w8ben' | 'w8bene';

export interface UploadTaxFormPdfResult {
  url: string;
  /** Currently null — phase 1 skips thumbnail generation (PDF embed used). */
  thumbUrl: string | null;
}

/**
 * Upload a generated tax-form PDF buffer to Supabase Storage and return the
 * public URL + (currently null) thumbnail URL. Throws on upload failure.
 */
export async function uploadTaxFormPdf(
  buffer: Buffer,
  userId: string,
  formType: TaxFormType,
): Promise<UploadTaxFormPdfResult> {
  const supabase = getSupabaseAdmin();
  const ts = Date.now();
  const path = `tax-forms/${userId}/${formType}-${ts}.pdf`;

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

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return {
    url: urlData.publicUrl,
    thumbUrl: null,
  };
}
