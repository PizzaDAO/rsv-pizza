import { Router, Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import { AppError } from '../middleware/error.js';

/**
 * taleggio-71042: server-side HEIC -> JPEG conversion fallback.
 *
 * The client-side `heic2any` codec (frozen libheif WASM) throws on iPhone
 * multi-image / HDR-gain-map HEICs, dropping the lightbox to its "Can't
 * preview HEIC files" error card. `heic-convert` (pure-JS libheif, no native
 * deps) decodes those files fine, so the frontend now points the HEIC <img>
 * at this endpoint instead of decoding in the browser.
 *
 * `sharp` on Vercel can't *decode* HEIC (prebuilt binary excludes libheif),
 * but it can process the already-decoded JPEG to normalize EXIF orientation
 * and cap the response size -- which is why heic-convert does the decode step.
 *
 * Public endpoint (no auth): it only re-serves objects that are already
 * publicly readable in our own Supabase storage, and an SSRF guard pins the
 * fetch to that exact host + public-object path prefix.
 */
const router = Router();

// Pin server-side fetches to our own public storage objects only.
const ALLOWED_ORIGIN = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const ALLOWED_PATH_PREFIX = '/storage/v1/object/public/';

router.get(
  '/convert',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.query.url;
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new AppError('Missing url parameter', 400, 'MISSING_URL');
      }

      // SSRF guard: only allow our exact storage origin + public-object path.
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new AppError('Invalid url parameter', 400, 'INVALID_URL');
      }
      if (
        parsed.origin !== ALLOWED_ORIGIN ||
        !parsed.pathname.startsWith(ALLOWED_PATH_PREFIX)
      ) {
        throw new AppError('url not allowed', 400, 'URL_NOT_ALLOWED');
      }

      // Fetch the HEIC bytes server-side (global fetch is available here).
      const upstream = await fetch(parsed.toString());
      if (!upstream.ok) {
        throw new AppError(
          `Upstream fetch failed (${upstream.status})`,
          502,
          'UPSTREAM_FETCH_FAILED'
        );
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());

      // Decode HEIC -> JPEG, then normalize orientation + cap size via sharp.
      // Any failure here (corrupt / unsupported source) -> 422 so the frontend
      // shows its error card.
      let outJpeg: Buffer;
      try {
        const convert = (await import('heic-convert')).default;
        const jpeg = await convert({ buffer, format: 'JPEG', quality: 0.85 });
        outJpeg = await sharp(Buffer.from(jpeg))
          .rotate()
          .resize({ width: 2400, withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new AppError('HEIC conversion failed', 422, 'HEIC_CONVERT_FAILED');
      }

      res.set('Content-Type', 'image/jpeg');
      // Deterministic per source URL -- let the CDN + browser cache it so the
      // ~1-3 s decode happens once.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(outJpeg);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
