/**
 * brick-oven-18875: turn whatever image a host picks into a square image ready to upload.
 * HEIC/HEIF is converted to JPEG (heic2any, already a dependency), non-square images are
 * center-cropped, and large photos are downscaled and re-encoded.
 */

export const SQUARE_IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const SQUARE_IMAGE_MAX_SIDE = 2048;
const JPEG_QUALITY = 0.9;

export type SquareImageErrorCode = 'NOT_IMAGE' | 'TOO_LARGE' | 'HEIC_FAILED' | 'LOAD_FAILED';

export class SquareImageError extends Error {
  constructor(public code: SquareImageErrorCode, message: string) {
    super(message);
  }
}

export function isHeicFile(file: { type?: string; name?: string }): boolean {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence' || /\.(heic|heif)$/.test(name);
}

export interface SquareCrop {
  sx: number;
  sy: number;
  size: number;
  /** Output edge in px (size, capped at maxSide). */
  outSize: number;
}

/** Center-crop rectangle for a width x height source, and the output edge after capping at maxSide. */
export function computeSquareCrop(width: number, height: number, maxSide = SQUARE_IMAGE_MAX_SIDE): SquareCrop {
  const size = Math.max(1, Math.min(width, height));
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
    outSize: Math.max(1, Math.min(size, maxSide)),
  };
}

async function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  const heic = isHeicFile(file);
  try {
    // Safari decodes HEIC natively; everything else decodes here.
    return await decode(file);
  } catch (nativeErr) {
    if (!heic) throw new SquareImageError('LOAD_FAILED', 'Could not read this image. Try a JPEG or PNG.');
    try {
      const heic2any = (await import('heic2any')).default;
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      return await decode(Array.isArray(out) ? out[0] : out);
    } catch (convErr) {
      console.error('HEIC to JPEG conversion failed:', nativeErr, convErr);
      throw new SquareImageError('HEIC_FAILED', 'Could not process this HEIC image. Please convert it to JPEG and try again.');
    }
  }
}

/** Returns a square JPEG/PNG/WebP File (center-cropped, at most 2048px). Throws SquareImageError. */
export async function prepareSquareImage(file: File): Promise<File> {
  const heic = isHeicFile(file);
  if (!heic && !file.type.startsWith('image/')) {
    throw new SquareImageError('NOT_IMAGE', 'Please select an image file');
  }
  if (file.size > SQUARE_IMAGE_MAX_INPUT_BYTES) {
    throw new SquareImageError('TOO_LARGE', 'Image must be less than 25MB');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new SquareImageError('LOAD_FAILED', 'This browser cannot process images.');
  }

  const bmp = await loadBitmap(file);
  const crop = computeSquareCrop(bmp.width, bmp.height);
  const keepsAlpha = !heic && (file.type === 'image/png' || file.type === 'image/webp');
  const mime = keepsAlpha ? file.type : 'image/jpeg';

  const canvas = document.createElement('canvas');
  canvas.width = crop.outSize;
  canvas.height = crop.outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close?.();
    throw new SquareImageError('LOAD_FAILED', 'This browser cannot process images.');
  }
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, crop.outSize, crop.outSize);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.outSize, crop.outSize);
  bmp.close?.();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, JPEG_QUALITY));
  if (!blob) throw new SquareImageError('LOAD_FAILED', 'Could not process this image.');
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = (file.name || 'event-image').replace(/\.[^.]+$/, '') || 'event-image';
  return new File([blob], `${base}.${ext}`, { type: blob.type || mime });
}
