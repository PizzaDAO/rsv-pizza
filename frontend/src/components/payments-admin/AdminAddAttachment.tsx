import React, { useRef, useState } from 'react';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { uploadPayoutPhoto } from '../../lib/supabase';
import { addAdminPayoutDocument } from '../../lib/api';

/**
 * sfincione-58500: a small self-contained uploader that lets a full payment
 * admin attach a receipt / pizza-proof / event-proof to an existing payout
 * straight from the /payments review modal.
 *
 * Upload flow: `uploadPayoutPhoto(file, partyId, payoutId, kind)` (the real
 * payoutId is fine as the storage path segment) → `addAdminPayoutDocument(...)`
 * → `onAdded()`. The backend OCRs receipts inline and mirrors pizza/event docs
 * into the gallery, so callers just re-fetch the payout detail in `onAdded`.
 *
 * Rendered only for full payment admins — the parent hides it for regional
 * underbosses.
 */

const RECEIPT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

interface AdminAddAttachmentProps {
  payoutId: string;
  partyId: string;
  mode: 'receipt' | 'photo';
  onAdded: () => void;
}

export const AdminAddAttachment: React.FC<AdminAddAttachmentProps> = ({
  payoutId,
  partyId,
  mode,
  onAdded,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  // photo mode picks between pizza / event proof; receipt mode is fixed.
  const [photoKind, setPhotoKind] = useState<'pizza' | 'event'>('pizza');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'reading'>('idle');
  const [error, setError] = useState<string | null>(null);

  const kind: 'receipt' | 'pizza' | 'event' =
    mode === 'receipt' ? 'receipt' : photoKind;
  const busy = status !== 'idle';

  const handleFile = async (file: File) => {
    setError(null);
    setStatus('uploading');
    try {
      const uploaded = await uploadPayoutPhoto(file, partyId, payoutId, kind);
      // Receipts get OCR'd server-side — surface a "reading" state so the
      // admin knows the request is still in flight after the upload finishes.
      if (kind === 'receipt') setStatus('reading');
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

  const accept = mode === 'receipt' ? RECEIPT_ACCEPT : PHOTO_ACCEPT;
  const buttonLabel =
    mode === 'receipt' ? 'Add receipt' : 'Add photo';

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {/* photo mode: two-way kind picker (Pizza proof | Event proof). */}
        {mode === 'photo' && (
          <div className="inline-flex rounded-lg border border-theme-stroke overflow-hidden text-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhotoKind('pizza')}
              className={`px-2.5 py-1.5 transition-colors ${
                photoKind === 'pizza'
                  ? 'bg-[#ff393a] text-white'
                  : 'bg-theme-surface text-theme-text-muted hover:text-theme-text'
              }`}
            >
              Pizza proof
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhotoKind('event')}
              className={`px-2.5 py-1.5 transition-colors ${
                photoKind === 'event'
                  ? 'bg-[#ff393a] text-white'
                  : 'bg-theme-surface text-theme-text-muted hover:text-theme-text'
              }`}
            >
              Event proof
            </button>
          </div>
        )}

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
        <span className="inline-flex items-center gap-1 text-xs text-red-400">
          <AlertCircle size={12} /> {error}
        </span>
      )}
    </div>
  );
};
