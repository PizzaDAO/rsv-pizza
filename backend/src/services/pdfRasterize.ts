/**
 * suppli-58533: rasterize the first page of a PDF receipt to a PNG buffer.
 *
 * WHY: hosts can now DM PDF receipts to Molto Benny (the Telegram bot forwards
 * them to POST /api/telegram/host-inbound with mimeType 'application/pdf').
 * gpt-4o vision CANNOT read a PDF via image_url — a PDF must be rasterized to a
 * raster image first. We render page 1 to a PNG and feed THAT into the exact
 * same receipt path every other image takes (upload PNG → analyzeReceipt → store
 * as a payout_documents receipt). The PNG also displays in the /payments receipt
 * <img> grids, where a raw PDF url would not render.
 *
 * LIBRARY CHOICE: `pdfjs-dist` (Mozilla's pdf.js, the `legacy/build` CommonJS-
 * friendly bundle) + `@napi-rs/canvas` (a PREBUILT native canvas). We
 * deliberately do NOT use:
 *   - the `canvas` npm package — it needs system libs (cairo/pango) that aren't
 *     present on Vercel's serverless Linux Node runtime.
 *   - `pdf-to-png-converter` (a pdfjs+canvas wrapper) — it builds a cmaps URL
 *     from a raw filesystem path and, on Windows, pdf.js rejects it with
 *     "Invalid factory url ... must include trailing slash"; it also hides the
 *     pdfjs options we need. Driving pdfjs directly lets us pass proper
 *     `file://` URLs (with trailing slash) for the standard fonts + cmaps so
 *     text and CJK receipts render.
 * `@napi-rs/canvas` ships prebuilt .node binaries per platform (incl. linux-x64
 * which Vercel uses), so there's no system-library/build-from-source dependency.
 *
 * RUNTIME CAVEAT: the native @napi-rs/canvas binary builds + runs locally, but
 * it must also load on Vercel's serverless Node runtime — that can only be truly
 * verified post-deploy. If it ever fails to load there, the caller's try/catch
 * surfaces a graceful "send a photo instead" reply rather than a 500.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// pdfjs's `legacy/build` is the Node-safe bundle (no DOM worker assumptions).
// Imported lazily inside the function so a load failure is caught by the caller.
const require = createRequire(import.meta.url);

/** Render scale. ~2x keeps small receipt text legible for the vision model. */
const RASTER_SCALE = 2;

export interface RasterizedPdf {
  pngBuffer: Buffer;
  pageCount: number;
}

/**
 * Rasterize page 1 of a PDF to a PNG buffer.
 *
 * Returns `{ pngBuffer, pageCount }`. Callers should log a warning when
 * pageCount > 1 (only page 1 is rendered) and treat a thrown error as
 * "couldn't read the PDF" (reply to the host, don't 500).
 */
export async function rasterizePdfFirstPage(
  pdfBuffer: Buffer,
): Promise<RasterizedPdf> {
  // Lazy ESM import of the legacy build (works under NodeNext + native fetch).
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');

  // Point pdf.js at the standard fonts + cmaps that ship inside pdfjs-dist, as
  // proper file:// URLs WITH a trailing slash (pdf.js requires the slash). This
  // lets standard-font and CJK receipts render glyphs instead of blanks.
  const pdfjsPkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const standardFontDataUrl = pathToFileURL(
    path.join(pdfjsPkgDir, 'standard_fonts') + path.sep,
  ).href;
  const cMapUrl = pathToFileURL(path.join(pdfjsPkgDir, 'cmaps') + path.sep).href;

  const loadingTask = pdfjsLib.getDocument({
    // pdf.js wants a Uint8Array; copy out of the Node Buffer.
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    // disableFontFace: render via the path generator (no DOM FontFace API on
    // the native canvas); isEvalSupported off for safety in a server context.
    disableFontFace: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  try {
    const pageCount: number = pdf.numPages;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: RASTER_SCALE });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // White backdrop so transparent PDFs don't OCR as black-on-black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      // pdf.js v4 also accepts the canvas itself; pass it for forward-compat.
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    if (!pngBuffer || pngBuffer.length === 0) {
      throw new Error('rasterized PNG was empty');
    }
    return { pngBuffer, pageCount };
  } finally {
    // Free pdf.js worker resources.
    try {
      await pdf.cleanup();
    } catch {
      /* best-effort */
    }
  }
}
