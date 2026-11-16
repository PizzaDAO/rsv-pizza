import express, { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
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

// Decoded RGBA is width*height*4 bytes, and a few-KB crafted HEVC can declare a huge canvas, so
// the declared size is checked (heic-decode's .all() reports it before decode()) before decoding.
export const HEIC_MAX_PIXELS = 100_000_000;

/** Decode the first image of a HEIC file (size-capped) and encode it as a JPEG capped to maxSide. */
export async function heicToJpeg(
  buffer: Buffer,
  opts: { quality: number; maxSide: number; fitInside?: boolean }
): Promise<Buffer> {
  let images: any;
  try {
    const decodeHeic = (await import('heic-decode')).default;
    images = await decodeHeic.all({ buffer });
  } catch {
    throw new AppError('HEIC conversion failed', 422, 'HEIC_CONVERT_FAILED');
  }
  try {
    const first = images[0];
    if (!first) throw new AppError('HEIC conversion failed', 422, 'HEIC_CONVERT_FAILED');
    if (!(first.width > 0 && first.height > 0) || first.width * first.height > HEIC_MAX_PIXELS) {
      throw new AppError('Image dimensions are too large (max 100 megapixels)', 413, 'HEIC_DIMENSIONS_TOO_LARGE');
    }
    try {
      const { width, height, data } = await first.decode();
      return await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
        .resize({
          width: opts.maxSide,
          ...(opts.fitInside ? { height: opts.maxSide, fit: 'inside' as const } : {}),
          withoutEnlargement: true,
        })
        .jpeg({ quality: opts.quality })
        .toBuffer();
    } catch {
      throw new AppError('HEIC conversion failed', 422, 'HEIC_CONVERT_FAILED');
    }
  } finally {
    try { images.dispose?.(); } catch { /* ignore */ }
  }
}

// Pin server-side fetches to our own public storage objects only.
const ALLOWED_ORIGIN = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const ALLOWED_PATH_PREFIX = '/storage/v1/object/public/';
// payout-receipts-private: legacy HEIC receipts moved to the private bucket are
// handed to the browser as short-lived signed URLs; allow converting those too
// (the signed URL is itself the access grant).
const ALLOWED_SIGNED_PREFIX = '/storage/v1/object/sign/payout-receipts/';

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
        !(parsed.pathname.startsWith(ALLOWED_PATH_PREFIX) || parsed.pathname.startsWith(ALLOWED_SIGNED_PREFIX))
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
      const outJpeg = await heicToJpeg(buffer, { quality: 85, maxSide: 2400 });

      res.set('Content-Type', 'image/jpeg');
      // Deterministic per source URL -- let the CDN + browser cache it so the
      // ~1-3 s decode happens once.
      // A signed private receipt must not outlive its token in a shared cache.
      res.set(
        'Cache-Control',
        parsed.pathname.startsWith(ALLOWED_SIGNED_PREFIX)
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
      );
      res.send(outJpeg);
    } catch (err) {
      next(err);
    }
  }
);

// brick-oven-18875: authenticated raw-bytes HEIC -> JPEG, the last-resort fallback for the
// event square-image picker (heic2any throws on many recent iPhone HEICs). Unlike /convert it
// takes the file itself, so it requires a signed-in user, a size cap, a HEIF brand check, and a
// tight per-user rate limit.
export const HEIC_UPLOAD_MAX_BYTES = 4.5 * 1024 * 1024; // Vercel serverless request-body limit
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);

/** True when the buffer starts with an ISO-BMFF ftyp box carrying a HEIF/HEIC brand. */
export function looksLikeHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.has(buf.toString('latin1', 8, 12));
}

const heicUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many conversions. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `heic:${(req as AuthRequest).userId ?? req.ip ?? 'anon'}`,
});

// body-parser's own 413 would otherwise reach the global handler as a 500.
const rawBody = (req: Request, res: Response, next: NextFunction) =>
  express.raw({ type: () => true, limit: HEIC_UPLOAD_MAX_BYTES })(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      return next(new AppError('File is too large (max 4.5MB)', 413, 'TOO_LARGE'));
    }
    next(err);
  });

router.post(
  '/to-jpeg',
  requireAuth,
  heicUploadLimiter,
  rawBody,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new AppError('Missing file body', 400, 'MISSING_BODY');
      }
      if (!looksLikeHeic(buffer)) {
        throw new AppError('Not a HEIC/HEIF file', 415, 'NOT_HEIC');
      }
      const outJpeg = await heicToJpeg(buffer, { quality: 90, maxSide: 2400, fitInside: true });
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, no-store');
      res.send(outJpeg);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
