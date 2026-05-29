/**
 * bocconcino-92104: shared PDF helpers for receipt uploads. Hosts can drop a
 * PDF receipt (the most common vendor email attachment); we render page 1
 * client-side to a PNG blob so:
 *   - the OCR pipeline (gpt-4o vision, image-only) has something to ingest
 *   - the receipt thumbnail in PayoutReviewModal / PayoutDetailModal /
 *     ReceiptsLibrary can use an <img> tag (PDFs won't render in <img>)
 *
 * Convention: the thumbnail PNG is uploaded alongside the canonical PDF in
 * Supabase Storage with a `.thumb.png` suffix on the URL. This avoids a
 * database migration for a `thumbnailUrl` column on payout_documents — both
 * the frontend display logic and the backend OCR pipeline derive the
 * thumbnail URL by string manipulation.
 */
import * as pdfjsLib from 'pdfjs-dist';
// Vite-friendly worker import — see https://github.com/mozilla/pdf.js/issues/15531
// for the `?url` query hint that ships the worker as a static asset.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Detect whether a file / URL / mimeType describes a PDF. Used at every
 * display + upload site so the PDF-vs-image branches share one source of
 * truth.
 */
export function isPdfFile(item: {
  mimeType?: string | null;
  fileName?: string | null;
  url?: string | null;
}): boolean {
  if (item.mimeType && item.mimeType.toLowerCase() === 'application/pdf') return true;
  const path = (item.fileName || item.url || '').toLowerCase();
  // Strip query string before checking the extension — Supabase URLs are
  // bare (no query), but defensive against future signed-URL use.
  const bare = path.split('?')[0];
  return bare.endsWith('.pdf');
}

/**
 * Derive the thumbnail URL for a PDF receipt by appending `.thumb.png` to
 * the canonical URL. Mirrors the upload-site convention in `uploadPayoutPhoto`.
 * For non-PDF inputs, returns the input URL unchanged so callers can use this
 * as a generic "give me a thumbnail" helper.
 */
export function derivePdfThumbnailUrl(url: string): string {
  return `${url}.thumb.png`;
}

/**
 * Render page 1 of a PDF File to a PNG Blob via pdfjs-dist's canvas backend.
 * Returns null if anything goes wrong (corrupt PDF, encrypted PDF, etc.) —
 * the caller should fall back to uploading the PDF without a thumbnail and
 * surface a console warning. OCR will still skip and the host can review
 * the file via the embed in the lightbox.
 *
 * Width is chosen so OCR has enough resolution to read receipt text without
 * blowing up the PNG file size; ~1600px on the long edge is a good balance.
 */
export async function renderPdfPageOneToPng(
  file: File,
  targetMaxWidth = 1600,
): Promise<Blob | null> {
  try {
    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1) {
      await pdf.destroy();
      return null;
    }
    const page = await pdf.getPage(1);

    // Compute the scale to bring the page's longest edge to targetMaxWidth.
    // PDF default viewport is at 72dpi — scale of 1 = 72dpi.
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(
      1,
      Math.min(4, targetMaxWidth / Math.max(baseViewport.width, baseViewport.height)),
    );
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      await pdf.destroy();
      return null;
    }

    // pdfjs-dist >=4 expects `canvas` in the render params; cast to satisfy
    // TS without pulling in @types/pdfjs's stricter HTMLCanvasElement shape.
    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    } as unknown as Parameters<typeof page.render>[0]).promise;

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    await pdf.destroy();
    return blob;
  } catch (err) {
    // Encrypted PDFs, malformed files, etc. Log but don't throw — the caller
    // proceeds with no thumbnail.
    // eslint-disable-next-line no-console
    console.warn('[pdfUtils] Failed to render PDF page 1 to PNG:', err);
    return null;
  }
}
