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
 *
 * pesto-92104: the lightbox can now host a right-pane editor (admin-only
 * receipt editor in PayoutReviewModal). When `editorPane` is non-null we
 * render a two-pane layout: photo on the left, editor on the right; on
 * narrow viewports (< md) the editor stacks below the photo. The lightbox
 * stays kind-agnostic — callers decide whether to render an editor based
 * on which image is current via `onIndexChange`. Optional shortcut hooks:
 *  - `onDuplicateShortcut` — fired on `D` keypress (admin "mark duplicate").
 *  - `onBeforeNavigate(direction)` — gate arrow / nav-button navigation so
 *    the parent can prompt about unsaved edits. Return `true` to proceed.
 */
export interface ReceiptLightboxImage {
  url: string;
  fileName: string;
  mimeType?: string;
  /**
   * nduja-58514: optional muted caption line shown in the footer under the
   * file name (e.g. "Uploaded Jun 7, 2026 by Jane"). Receipts pass none;
   * event/pizza photos pass an uploader+timestamp string so the /payments
   * photo lightbox mirrors what receipts already surface. Additive — images
   * without a caption render exactly as before.
   */
  caption?: string;
}

interface ReceiptLightboxProps {
  isOpen: boolean;
  images: ReceiptLightboxImage[];
  /** Index into `images` to display on open. Defaults to 0. */
  initialIndex?: number;
  onClose: () => void;
  /**
   * pesto-92104: editor pane content for the CURRENT image. When non-null
   * the lightbox switches to a 2-pane layout (photo left, editor right on
   * desktop; stacked on mobile). The parent component is responsible for
   * deciding what to render based on `onIndexChange` — pass `null` to
   * render the plain photo-only lightbox (event photos, pizza photos,
   * non-admin viewers, etc.).
   */
  editorPane?: React.ReactNode;
  /**
   * pesto-92104: notified whenever the displayed image changes (open,
   * prev/next, initialIndex clamp). Parent uses this to swap the editor
   * pane content to match the current doc.
   */
  onIndexChange?: (idx: number) => void;
  /**
   * pesto-92104: optional gate for nav (arrows + nav buttons). Return
   * `false` (or a Promise resolving to `false`) to cancel navigation —
   * used by PayoutReviewModal to prompt "Save changes before navigating?"
   * when the editor has unsaved drafts.
   */
  onBeforeNavigate?: (direction: 'prev' | 'next') => boolean | Promise<boolean>;
  /**
   * pesto-92104: `D` keypress handler. Wired by PayoutReviewModal to the
   * mark-duplicate toggle for the current receipt. Lightbox only fires
   * when admin context provides this prop.
   */
  onDuplicateShortcut?: () => void;
  /**
   * marinara-61455: `V` keypress handler. Wired by PayoutReviewModal to run the
   * image-authenticity check for the current receipt. Only fires when admin
   * context provides this prop (same guard pattern as onDuplicateShortcut).
   */
  onVerifyShortcut?: () => void;
  /**
   * coppa-92105: when true, render a heavy DUPLICATE banner across the top
   * of the photo + diagonal-stripe overlay across the image so admins can't
   * confuse a duplicate receipt for a valid one while reviewing it
   * full-screen. Parent decides per-image via the same onIndexChange hook
   * used to pick `editorPane`. Pure visual — no behavior change.
   */
  isDuplicate?: boolean;
  /**
   * provola-92106: same as `isDuplicate` but for the ineligible flag —
   * amber INELIGIBLE banner + 135° amber stripe overlay. When both flags
   * are true, the duplicate visual wins (parent should pass `isIneligible`
   * as false when also passing `isDuplicate=true`). Pure visual.
   */
  isIneligible?: boolean;
  /**
   * marinara-61455: when the current receipt's image is flagged AI-generated /
   * doctored ('suspicious' | 'likely_fake'), paint the photo pane with a purple
   * banner + 90° purple stripe overlay (distinct from duplicate red/45° and
   * ineligible amber/135°). 'authentic' / undefined render nothing. Pure visual
   * + advisory — never gates anything. Rendered alongside (not instead of) the
   * duplicate / ineligible overlays since they're orthogonal signals.
   */
  authenticityVerdict?: 'authentic' | 'suspicious' | 'likely_fake' | null;
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

// taleggio-71042: backend HEIC->JPEG convert endpoint base. Same VITE_API_URL
// resolution as frontend/src/lib/api.ts so previews hit the prod backend and
// local dev hits localhost:3006.
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

export const ReceiptLightbox: React.FC<ReceiptLightboxProps> = ({
  isOpen,
  images,
  initialIndex = 0,
  onClose,
  editorPane,
  onIndexChange,
  onBeforeNavigate,
  onDuplicateShortcut,
  onVerifyShortcut,
  isDuplicate = false,
  isIneligible = false,
  authenticityVerdict = null,
}) => {
  // marinara-61455: only paint when the verdict actually flags the image.
  const authFlagged =
    authenticityVerdict === 'suspicious' || authenticityVerdict === 'likely_fake';
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
      // pesto-92104: notify parent of the starting index so it can prime
      // the editor pane for the right doc.
      onIndexChange?.(safe);
    }
    // We intentionally exclude `onIndexChange` from deps — it's a callback
    // the parent may re-create per render, and we only want to fire on
    // open / initialIndex change to avoid an effect loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialIndex, images.length]);

  const count = images.length;
  const hasMultiple = count > 1;
  const hasEditor = editorPane != null && editorPane !== false;

  const goPrev = useCallback(async () => {
    if (count === 0) return;
    // pesto-92104: gate on parent-supplied unsaved-edits prompt.
    if (onBeforeNavigate) {
      const ok = await onBeforeNavigate('prev');
      if (!ok) return;
    }
    setIndex((i) => {
      const next = (i - 1 + count) % count;
      onIndexChange?.(next);
      return next;
    });
  }, [count, onBeforeNavigate, onIndexChange]);
  const goNext = useCallback(async () => {
    if (count === 0) return;
    if (onBeforeNavigate) {
      const ok = await onBeforeNavigate('next');
      if (!ok) return;
    }
    setIndex((i) => {
      const next = (i + 1) % count;
      onIndexChange?.(next);
      return next;
    });
  }, [count, onBeforeNavigate, onIndexChange]);

  // Keyboard nav — Esc closes, arrows cycle (when more than one image).
  // pesto-92104: `D` fires onDuplicateShortcut (admin only — guarded by the
  // prop being supplied). Ignore arrows + D when focus is inside an editable
  // input so the caret moves / the letter types in a text field (e.g. a
  // receipt note) instead of changing receipts or toggling duplicate.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // When focus is inside an editable field, let arrow keys move the caret
      // and `D` type normally instead of hijacking them for nav/shortcuts.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (target?.isContentEditable ?? false);
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && hasMultiple) {
        if (editable) return;
        e.preventDefault();
        void goPrev();
      } else if (e.key === 'ArrowRight' && hasMultiple) {
        if (editable) return;
        e.preventDefault();
        void goNext();
      } else if ((e.key === 'd' || e.key === 'D') && onDuplicateShortcut) {
        if (editable) return;
        e.preventDefault();
        onDuplicateShortcut();
      } else if ((e.key === 'v' || e.key === 'V') && onVerifyShortcut) {
        // marinara-61455: V = run image-authenticity check on the current receipt.
        if (editable) return;
        e.preventDefault();
        onVerifyShortcut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, goPrev, goNext, hasMultiple, onDuplicateShortcut, onVerifyShortcut]);

  const current = images[index];
  const heic = isHeic(current);

  // taleggio-71042: HEIC receipts can't render in an <img> natively. The old
  // client-side heic2any WASM decode threw on multi-image / HDR-gain-map iPhone
  // HEICs, so we now point the <img> at the backend convert endpoint
  // (/api/heic/convert), which decodes via the pure-JS heic-convert codec and
  // returns a cached JPEG. The <img> onLoad / onError below drive this state
  // machine. Hook MUST live above the early return so the hook order stays
  // stable (adding a hook below a conditional return has black-screened this
  // app before).
  const [heicStatus, setHeicStatus] = React.useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  // Reset to the loading spinner whenever the HEIC source changes (open or
  // arrow-nav to a different HEIC) so a previously-decoded image doesn't flash
  // its ready / error state onto the new file before the new <img> loads.
  useEffect(() => {
    if (isOpen && heic) setHeicStatus('loading');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, heic, current?.url]);

  if (!isOpen || count === 0 || !current) return null;

  // taleggio-71042: HEIC files are served through the backend converter as
  // JPEG. encodeURIComponent the storage URL so its query string survives.
  const convertUrl = heic
    ? `${API_URL}/api/heic/convert?url=${encodeURIComponent(current.url)}`
    : '';

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

  // pesto-92104: when an editor pane is supplied we render a two-column
  // layout (photo left, editor right). Stacked on narrow viewports so the
  // editor doesn't crowd the photo. Photo + editor each take ~half the
  // viewport; the photo's max-height is dialed down so the editor stays
  // visible without forcing scroll on common laptop sizes.
  const mediaSizing = hasEditor
    ? 'max-h-[50vh] md:max-h-[85vh] max-w-full md:max-w-full'
    : 'max-h-[90vh] max-w-[90vw]';

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
              void goPrev();
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
              void goNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white p-2 rounded-full bg-black/40 hover:bg-black/60 z-10"
            aria-label="Next image"
          >
            <ChevronRight size={32} />
          </button>
        </>
      )}

      {/* pesto-92104: outer container switches between centered single-pane
          (photo only) and a 2-column / stacked grid when an editor pane is
          supplied. Stop click propagation so neither pane is a click-through
          dead zone that triggers close. */}
      <div
        className={
          hasEditor
            ? 'w-full max-w-[95vw] max-h-[95vh] grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden'
            : 'max-w-[90vw] max-h-[90vh] flex items-center justify-center'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`relative ${
            hasEditor
              ? 'flex items-center justify-center min-h-0'
              : 'flex items-center justify-center'
          }`}
        >
          {/* coppa-92105: heavy DUPLICATE banner + diagonal-stripe overlay
              on the photo pane when the current receipt is admin-marked as
              a duplicate. Pointer-events-none so the underlying photo / nav
              controls stay interactive. */}
          {isDuplicate && (
            <>
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-bold uppercase tracking-wide shadow-lg pointer-events-none">
                Duplicate — excluded from totals
              </div>
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(239,68,68,0.18) 0 6px, transparent 6px 14px)',
                }}
              />
            </>
          )}
          {/* provola-92106: parallel INELIGIBLE banner — amber, 135° stripes
              (distinct from duplicate's red / 45°). Rendered only when NOT
              also duplicate so the two patterns don't fight when both are
              on (duplicate wins as the primary signal per task spec). */}
          {isIneligible && !isDuplicate && (
            <>
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-bold uppercase tracking-wide shadow-lg pointer-events-none">
                Ineligible — excluded from totals
              </div>
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(135deg, rgba(245,158,11,0.18) 0 6px, transparent 6px 14px)',
                }}
              />
            </>
          )}
          {/* marinara-61455: purple AUTHENTICITY banner + 90° stripe overlay
              when the focused receipt image is flagged AI-generated / doctored.
              Orthogonal to duplicate / ineligible — can co-exist; offset the
              banner down a row so it doesn't overlap the duplicate/ineligible
              pill when multiple flags are on. Pointer-events-none. */}
          {authFlagged && (
            <>
              <div
                className={`absolute ${
                  isDuplicate || isIneligible ? 'top-10' : 'top-2'
                } left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-purple-600 text-white text-xs font-bold uppercase tracking-wide shadow-lg pointer-events-none`}
              >
                {authenticityVerdict === 'likely_fake'
                  ? 'Likely AI / doctored'
                  : 'Authenticity — needs review'}
              </div>
              <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgba(168,85,247,0.16) 0 6px, transparent 6px 14px)',
                }}
              />
            </>
          )}
          {heic ? (
            /* taleggio-71042: HEIC is converted server-side to JPEG and
               served by /api/heic/convert. The <img> below always renders
               (driving onLoad/onError); while it loads we overlay the
               "Converting HEIC…" spinner, and only on a hard onError do we
               fall back to the open-in-new-tab card. */
            <div className="relative flex items-center justify-center">
              {heicStatus !== 'error' && (
                <img
                  key={convertUrl}
                  src={convertUrl}
                  alt={current.fileName}
                  onLoad={() => setHeicStatus('ready')}
                  onError={() => setHeicStatus('error')}
                  className={`${mediaSizing} object-contain ${
                    heicStatus === 'ready' ? '' : 'invisible'
                  }`}
                />
              )}
              {heicStatus === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-theme-surface text-theme-text rounded-2xl border border-theme-stroke px-6 py-8 max-w-md text-center space-y-3">
                    <div className="mx-auto h-8 w-8 rounded-full border-2 border-theme-stroke border-t-[#ff393a] animate-spin" />
                    <p className="text-sm font-semibold">Converting HEIC…</p>
                    <p className="text-xs text-theme-text-muted truncate">{current.fileName}</p>
                  </div>
                </div>
              )}
              {heicStatus === 'error' && (
                /* Conversion failed -- fall back to the open-in-new-tab card. */
                <div className="bg-theme-surface text-theme-text rounded-2xl border border-theme-stroke px-6 py-8 max-w-md text-center space-y-3">
                  <p className="text-sm font-semibold">Can't preview HEIC files</p>
                  <p className="text-xs text-theme-text-muted">
                    This <span className="font-mono">.heic</span> image couldn't be
                    converted for preview. Open the file in a new tab to download or
                    view it.
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
              )}
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
              className={mediaSizing}
            />
          ) : pdf ? (
            /* bocconcino-92104: embedded native PDF viewer (Chrome/Edge/Safari/
               Firefox all support this). Keyed on URL so arrow-nav across the
               carousel remounts the embed with the new source instead of
               caching the previous file. Sized to match other media slots. */
            <div
              className={`relative ${hasEditor ? 'w-full h-[50vh] md:h-[85vh]' : 'w-[90vw] h-[90vh]'} bg-white rounded-md overflow-hidden`}
            >
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
              className={`${mediaSizing} object-contain`}
            />
          )}
        </div>

        {/* pesto-92104: editor pane. Scrolls independently so a long
            line-items list doesn't push the photo off-screen. */}
        {hasEditor && (
          <div className="min-h-0 overflow-y-auto rounded-xl bg-theme-surface border border-theme-stroke">
            {editorPane}
          </div>
        )}
      </div>

      {/* Footer — counter + file name. Only show counter when more than one.
          pesto-92104: when an editor is showing, anchor the footer at the
          bottom of the PHOTO pane instead of the centre so it doesn't
          overlap the editor on the right. */}
      <div
        className={`absolute ${
          hasEditor ? 'bottom-4 left-4 md:left-[25%]' : 'bottom-4 left-1/2 -translate-x-1/2'
        } text-white/90 text-xs sm:text-sm flex items-center gap-2 bg-black/40 rounded-full px-3 py-1.5 max-w-[90vw]`}
      >
        {hasMultiple && (
          <span className="font-medium">
            {index + 1} of {count}
          </span>
        )}
        <span className="truncate">{current.fileName}</span>
        {/* nduja-58514: muted uploader + timestamp caption for event/pizza
            photos. Receipts pass no caption and render unchanged. */}
        {current.caption && (
          <span className="truncate text-white/60">· {current.caption}</span>
        )}
      </div>
    </div>,
    document.body,
  );
};
