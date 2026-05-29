import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { isVideoFile } from '../../lib/mediaUtils';
import { isPdfFile } from '../../lib/pdfUtils';

/**
 * bresaola-89172: focused full-screen overlay for receipt / pizza-photo
 * thumbnails on the /payments dashboards (admin + host). Clicking a
 * thumbnail opens this lightbox instead of doing nothing or popping a raw
 * URL into a new tab.
 *
 * Behaviour:
 * - Black backdrop, click backdrop OR press Esc to close.
 * - Image centered, contained to 90vw / 90vh.
 * - Multi-image: left/right arrows + footer "N of M" counter; ArrowLeft /
 *   ArrowRight keys also navigate.
 * - HEIC files can't be previewed natively in browsers — show a fallback
 *   link to open the raw URL in a new tab.
 */
export interface ReceiptLightboxImage {
  url: string;
  fileName: string;
  mimeType?: string;
}

interface ReceiptLightboxProps {
  isOpen: boolean;
  images: ReceiptLightboxImage[];
  /** Index into `images` to display on open. Defaults to 0. */
  initialIndex?: number;
  onClose: () => void;
}

/** Some HEIC files come through with non-image/heic MIME types or no MIME at
 *  all (the browser leaves it blank for unrecognised types). Match both the
 *  MIME and the file-name extension. */
function isHeic(image: ReceiptLightboxImage | undefined): boolean {
  if (!image) return false;
  const mime = (image.mimeType || '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  const name = (image.fileName || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

export const ReceiptLightbox: React.FC<ReceiptLightboxProps> = ({
  isOpen,
  images,
  initialIndex = 0,
  onClose,
}) => {
  // Index lives in this component so callers only need to pass the starting
  // image. Reset whenever the lightbox is (re-)opened so each open starts
  // from `initialIndex`.
  const [index, setIndex] = React.useState(initialIndex);
  useEffect(() => {
    if (isOpen) {
      // Clamp to valid range — `initialIndex` from the caller might be stale
      // by the time the lightbox opens.
      const safe = Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)));
      setIndex(safe);
    }
  }, [isOpen, initialIndex, images.length]);

  const count = images.length;
  const hasMultiple = count > 1;

  const goPrev = useCallback(() => {
    if (count === 0) return;
    setIndex((i) => (i - 1 + count) % count);
  }, [count]);
  const goNext = useCallback(() => {
    if (count === 0) return;
    setIndex((i) => (i + 1) % count);
  }, [count]);

  // Keyboard nav — Esc closes, arrows cycle (when more than one image).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && hasMultiple) {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' && hasMultiple) {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, goPrev, goNext, hasMultiple]);

  if (!isOpen || count === 0) return null;

  const current = images[index];
  if (!current) return null;
  const heic = isHeic(current);
  // melanzane-92103: when the focused item is a video, render a <video> with
  // controls + autoplay so admins can scrub. `muted` is required for autoplay
  // under browser policy; `playsInline` keeps mobile from kicking into the
  // fullscreen video shell.
  const video = !heic && isVideoFile(current);
  // bocconcino-92104: PDF receipts render via <embed> so admins / hosts can
  // scroll multi-page receipts (vendor scans often include itemization on
  // pages 2+). Falls back to a download link for browsers without a native
  // PDF viewer.
  const pdf = !heic && !video && isPdfFile(current);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={(e) => {
        // React event propagation follows the React tree, not the DOM tree.
        // Even though this div is portalled into document.body, click events
        // still bubble up to parent components (e.g. an enclosing modal whose
        // own backdrop closes it). Stop the bubble so closing the lightbox
        // doesn't also close the parent modal.
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Receipt preview"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 hover:bg-black/60 z-10"
        aria-label="Close preview"
      >
        <X size={20} />
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-2 rounded-full bg-black/40 hover:bg-black/60 z-10"
            aria-label="Previous image"
          >
            <ChevronLeft size={32} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-2 rounded-full bg-black/40 hover:bg-black/60 z-10"
            aria-label="Next image"
          >
            <ChevronRight size={32} />
          </button>
        </>
      )}

      {/* Main content — image OR HEIC fallback. Stop click propagation so the
          centered image isn't a click-through dead zone that triggers close. */}
      <div
        className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {heic ? (
          <div className="bg-theme-surface text-theme-text rounded-2xl border border-theme-stroke px-6 py-8 max-w-md text-center space-y-3">
            <p className="text-sm font-semibold">Can't preview HEIC files</p>
            <p className="text-xs text-theme-text-muted">
              Your browser doesn't render <span className="font-mono">.heic</span>{' '}
              images natively. Open the file in a new tab to download or view it.
            </p>
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[#ff393a] hover:underline"
            >
              Open in new tab <ExternalLink size={14} />
            </a>
            <p className="text-xs text-theme-text-muted truncate">{current.fileName}</p>
          </div>
        ) : video ? (
          /* melanzane-92103: keying on src so swapping between videos via
             arrow nav cleanly remounts the <video> with the new source. */
          <video
            key={current.url}
            src={current.url}
            controls
            autoPlay
            muted
            playsInline
            className="max-h-[90vh] max-w-[90vw]"
          />
        ) : pdf ? (
          /* bocconcino-92104: embedded native PDF viewer (Chrome/Edge/Safari/
             Firefox all support this). Keyed on URL so arrow-nav across the
             carousel remounts the embed with the new source instead of
             caching the previous file. Sized to match other media slots. */
          <div className="relative w-[90vw] h-[90vh] bg-white rounded-md overflow-hidden">
            <embed
              key={current.url}
              src={current.url}
              type="application/pdf"
              className="w-full h-full"
            />
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-2 right-2 inline-flex items-center gap-1.5 text-xs bg-black/60 text-white rounded-full px-2.5 py-1 hover:bg-black/80"
            >
              Open in new tab <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <img
            src={current.url}
            alt={current.fileName}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        )}
      </div>

      {/* Footer — counter + file name. Only show counter when more than one. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/90 text-xs sm:text-sm flex items-center gap-2 bg-black/40 rounded-full px-3 py-1.5 max-w-[90vw]">
        {hasMultiple && (
          <span className="font-medium">
            {index + 1} of {count}
          </span>
        )}
        <span className="truncate">{current.fileName}</span>
      </div>
    </div>,
    document.body,
  );
};
