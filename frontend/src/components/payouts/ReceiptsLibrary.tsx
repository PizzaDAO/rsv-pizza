import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, RefreshCw, FileText, ExternalLink, Play } from 'lucide-react';
import { fetchReceiptsLibrary } from '../../lib/api';
import type { ReceiptLibraryEntry } from '../../types';
import { PayoutStatusPill } from '../payments-shared/PayoutStatusPill';
import { ReceiptLightbox } from '../payments-shared';
import { isVideoFile } from '../../lib/mediaUtils';
import { isPdfFile, derivePdfThumbnailUrl } from '../../lib/pdfUtils';

interface ReceiptsLibraryProps {
  partyId: string;
}

/**
 * ravioli-82931 + agnolotti-58291: "Receipts" section on the host PayoutsTab.
 *
 * After agnolotti-58291 this is a PARTY-scoped library — every receipt
 * uploaded against the party is listed, regardless of which cohost submitted
 * it (visibility now matches event-edit access, not the original uploader).
 * Receipts also survive both soft-withdraw (ravioli-82931) and hard-delete
 * of the parent payout (FK SET NULL), so historical evidence stays reachable.
 *
 * Read-only: hosts can view the full image in a new tab but can't delete
 * entries here. Receipt removal still goes through the source payout's
 * pending-only edit flow.
 */
export const ReceiptsLibrary: React.FC<ReceiptsLibraryProps> = ({ partyId }) => {
  const { t } = useTranslation('host');
  const [receipts, setReceipts] = useState<ReceiptLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // bresaola-89172: lightbox state — store the initial index so clicking a
  // specific row opens that image first and the carousel can step through
  // every receipt in the library.
  const [lightboxState, setLightboxState] = useState<{ open: boolean; initialIndex: number }>({
    open: false,
    initialIndex: 0,
  });
  // soppressata-92110: mirror the lightbox's current index so the read-only
  // DUPLICATE / INELIGIBLE banners paint the matching receipt.
  const [lightboxCurrentIndex, setLightboxCurrentIndex] = useState(0);
  const lightboxCurrentReceipt = receipts[lightboxCurrentIndex] ?? null;

  // Build the carousel list once per receipts array. Includes every entry —
  // non-image rows still get a fallback render inside the lightbox via the
  // HEIC pathway, and unknown formats degrade gracefully.
  const lightboxImages = useMemo(
    () =>
      receipts.map((r) => ({
        url: r.url,
        fileName: r.fileName,
        mimeType: r.mimeType,
      })),
    [receipts],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReceiptsLibrary(partyId)
      .then((rows) => {
        if (!cancelled) setReceipts(rows);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load receipts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const reload = () => {
    setLoading(true);
    setError(null);
    fetchReceiptsLibrary(partyId)
      .then(setReceipts)
      .catch((err: any) => setError(err?.message || 'Failed to load receipts'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-theme-text">Receipts</h2>
          <p className="text-xs text-white/40 mt-1">
            Every receipt uploaded for this event by any host, including withdrawn requests.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="w-8 h-8 text-[#ff393a]" />
          <p className="text-sm text-theme-text-secondary">{error}</p>
          <button
            onClick={reload}
            className="btn-secondary inline-flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && receipts.length === 0 && (
        <p className="text-sm text-theme-text-secondary py-6 text-center">
          Receipts uploaded by any host appear here.
        </p>
      )}

      {!loading && !error && receipts.length > 0 && (
        <ul className="divide-y divide-theme-stroke">
          {receipts.map((r, idx) => {
            const isVideo = isVideoFile(r);
            const isPdf = !isVideo && isPdfFile(r);
            const isImage = !isVideo && !isPdf && (r.mimeType || '').startsWith('image/');
            const formattedDate = new Date(r.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
            // agnolotti-58291: prefer the uploader's display name, fall back
            // to the cached email when the User row has been deleted. Empty
            // when both are missing (historical pre-pancetta receipts).
            const uploader = r.uploadedByName || r.uploadedByEmail || null;
            // soppressata-92110: read-only admin exclusion flags. Duplicate
            // wins when both are set (same convention as the admin grid).
            const isDup = r.isDuplicate === true;
            const isIne = r.ineligible === true && !isDup;
            const flagged = isDup || isIne;
            return (
              <li key={r.id} className={`flex items-center gap-3 py-3 ${flagged ? 'opacity-60' : ''}`}>
                {/* bresaola-89172: thumbnail wrapped in a button so clicking
                    opens the shared lightbox carousel scrolled to this row.
                    Non-image rows (PDFs etc.) still open in a new tab via
                    the lightbox's HEIC-style fallback. */}
                <button
                  type="button"
                  onClick={() => setLightboxState({ open: true, initialIndex: idx })}
                  className="relative flex-shrink-0 rounded border border-theme-stroke overflow-hidden hover:opacity-80 transition-opacity"
                  aria-label={`Open ${r.fileName}`}
                  title={r.fileName}
                >
                  {isVideo ? (
                    /* melanzane-92103: receipt-library entries can include
                        video uploads — render the first frame via <video
                        preload="metadata"> with a small play overlay. */
                    <div className="relative w-12 h-12">
                      <video
                        src={r.url}
                        preload="metadata"
                        muted
                        playsInline
                        className="w-12 h-12 object-cover block"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-black/50 rounded-full p-1">
                          <Play className="text-white" size={10} fill="white" />
                        </div>
                      </div>
                    </div>
                  ) : isImage ? (
                    <img
                      src={r.url}
                      alt={r.fileName}
                      className="w-12 h-12 object-cover block"
                      loading="lazy"
                    />
                  ) : isPdf ? (
                    /* bocconcino-92104: PDFs render via the convention-derived
                       `.thumb.png` sibling (uploaded client-side when the PDF
                       was first attached). If the thumbnail is missing (pre-
                       bocconcino rows, render failed), fall back to a generic
                       PDF icon via the broken-image swap. */
                    <PdfThumb url={r.url} fileName={r.fileName} />
                  ) : (
                    <div className="w-12 h-12 bg-theme-surface-hover flex items-center justify-center">
                      <FileText size={20} className="text-theme-text-secondary" />
                    </div>
                  )}
                  {/* soppressata-92110: diagonal-stripe overlay marks flagged
                      receipts as excluded at thumbnail size (red 45° for
                      duplicate, amber 135° for ineligible). */}
                  {flagged && (
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage: isDup
                          ? 'repeating-linear-gradient(45deg, rgba(239,68,68,0.30) 0 4px, transparent 4px 8px)'
                          : 'repeating-linear-gradient(135deg, rgba(245,158,11,0.30) 0 4px, transparent 4px 8px)',
                      }}
                    />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-theme-text truncate">
                      {r.fileName}
                    </span>
                    {r.payoutStatus && <PayoutStatusPill status={r.payoutStatus} />}
                    {/* soppressata-92110: read-only exclusion pill. Explicit
                        white text (text-[#ffffff]) dodges the `.gpp-theme
                        .text-white` override on GPP host pages. */}
                    {isDup && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-[#ffffff]">
                        {t('payouts.duplicatePill')}
                      </span>
                    )}
                    {isIne && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-[#ffffff]">
                        {t('payouts.ineligiblePill')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">
                    Uploaded {formattedDate}
                    {uploader && <> by {uploader}</>}
                    {r.ocrAmount != null && r.ocrCurrency && (
                      <> — {r.ocrAmount.toFixed(2)} {r.ocrCurrency}</>
                    )}
                  </div>
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#ff393a] hover:underline inline-flex items-center gap-1 flex-shrink-0"
                >
                  View full
                  <ExternalLink size={12} />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {/* soppressata-92110: explain the exclusion when any receipt is flagged. */}
      {!loading && !error && receipts.some(r => r.isDuplicate === true || r.ineligible === true) && (
        <p className="text-xs text-theme-text-muted mt-3 italic">
          {t('payouts.excludedNote')}
        </p>
      )}

      <ReceiptLightbox
        isOpen={lightboxState.open}
        images={lightboxImages}
        initialIndex={lightboxState.initialIndex}
        onClose={() => setLightboxState({ open: false, initialIndex: 0 })}
        onIndexChange={setLightboxCurrentIndex}
        /* soppressata-92110: READ-ONLY duplicate / ineligible banners. No
           onDuplicateShortcut / editorPane — hosts can't toggle these. */
        isDuplicate={lightboxCurrentReceipt?.isDuplicate === true}
        isIneligible={
          lightboxCurrentReceipt?.ineligible === true
          && lightboxCurrentReceipt?.isDuplicate !== true
        }
      />
    </div>
  );
};

/**
 * bocconcino-92104: thumbnail slot for PDF receipts. Tries the derived
 * `.thumb.png` sibling first; on 404 (thumbnail upload failed or row
 * predates bocconcino-92104), swaps to a generic PDF icon so the list
 * still renders cleanly.
 */
const PdfThumb: React.FC<{ url: string; fileName: string }> = ({ url, fileName }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-12 h-12 bg-theme-surface-hover flex items-center justify-center">
        <FileText size={20} className="text-theme-text-secondary" />
      </div>
    );
  }
  return (
    <img
      src={derivePdfThumbnailUrl(url)}
      alt={fileName}
      className="w-12 h-12 object-cover block"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
};
