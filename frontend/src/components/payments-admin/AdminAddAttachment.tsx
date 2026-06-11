import React, { useRef, useState } from 'react';
import { Loader2, Plus, AlertCircle, RotateCw } from 'lucide-react';
import { uploadPayoutPhoto } from '../../lib/supabase';
import { addAdminPayoutDocument } from '../../lib/api';

/**
 * sfincione-58500: a small self-contained uploader that lets a full payment
 * admin attach a receipt to an existing payout straight from the /payments
 * review modal.
 *
 * Upload flow: `uploadPayoutPhoto(file, partyId, payoutId, 'receipt')` (the real
 * payoutId is fine as the storage path segment) → `addAdminPayoutDocument(...)`
 * → `onAdded()`. The backend OCRs receipts inline, so callers just re-fetch the
 * payout detail in `onAdded`.
 *
 * provolone-58531: this control is now RECEIPT-ONLY. Admin photo attachment
 * moved onto the host role model via AdminAddPhotosModal (EventPhotosCard).
 *
 * Rendered only for full payment admins — the parent hides it for regional
 * underbosses.
 */

const RECEIPT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

interface AdminAddAttachmentProps {
  payoutId: string;
  partyId: string;
  // provolone-58531: kept for call-site compatibility, but only 'receipt' is
  // used now (the 'photo' branch was removed).
  mode?: 'receipt';
  onAdded: () => void;
}

export const AdminAddAttachment: React.FC<AdminAddAttachmentProps> = ({
  payoutId,
  partyId,
  onAdded,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'reading'>('idle');
  const [error, setError] = useState<string | null>(null);
  // focaccia-58519: keep the last picked file so a transient failure can be
  // retried without re-selecting it.
  const lastFileRef = useRef<File | null>(null);

  const kind = 'receipt' as const;
  const busy = status !== 'idle';

  // focaccia-58519: deterministic local-validation rejections aren't retryable.
  const retryable =
    !!error &&
    !error.startsWith('File is too large') &&
    !error.startsWith('Unsupported file type');

  const handleFile = async (file: File) => {
    lastFileRef.current = file;
    setError(null);
    setStatus('uploading');
    try {
      const uploaded = await uploadPayoutPhoto(file, partyId, payoutId, kind);
      // Receipts get OCR'd server-side — surface a "reading" state so the
      // admin knows the request is still in flight after the upload finishes.
      setStatus('reading');
      await addAdminPayoutDocument(payoutId, {
        kind,
        url: uploaded.url,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
      });
      setStatus('idle');
      onAdded();
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const accept = RECEIPT_ACCEPT;
  const buttonLabel = 'Add receipt';

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-theme-surface border border-theme-stroke text-theme-text hover:border-[#ff393a]/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'uploading' ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Uploading…
            </>
          ) : status === 'reading' ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Reading receipt…
            </>
          ) : (
            <>
              <Plus size={13} /> {buttonLabel}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-red-400 max-w-[16rem] truncate" title={error}>
            <AlertCircle size={12} className="flex-shrink-0" /> {error}
          </span>
          {retryable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (lastFileRef.current) handleFile(lastFileRef.current);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 disabled:opacity-50 transition-colors"
            >
              <RotateCw size={11} /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
};
