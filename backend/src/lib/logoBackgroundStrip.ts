import sharp from 'sharp';

/**
 * Classifies and strips white backgrounds from logo images.
 *
 * Used by the graphics-admin "logo cleanup" tool. See sausage-22549.
 */

export type LogoClass =
  | 'transparent_png'
  | 'white_bg_png'
  | 'jpeg_white'
  | 'jpeg_other'
  | 'opaque_color_png'
  | 'mixed_png'
  | 'svg'
  | 'unknown';

// Anything with R/G/B >= NEAR_WHITE counts as "near-white" for both
// classification and flood-fill seeding/neighbor expansion.
const NEAR_WHITE = 240;

// Alpha >= ALPHA_OPAQUE is considered fully opaque.
const ALPHA_OPAQUE = 240;

interface CornerSample {
  r: number;
  g: number;
  b: number;
  a: number;
}

function sampleCorners(raw: Buffer, width: number, height: number, channels: number): CornerSample[] {
  const inset = 2;
  // Clamp inset for very small images
  const ix = Math.min(inset, Math.max(0, width - 1));
  const iy = Math.min(inset, Math.max(0, height - 1));

  const positions: Array<[number, number]> = [
    [ix, iy],                                  // top-left
    [width - 1 - ix, iy],                      // top-right
    [ix, height - 1 - iy],                     // bottom-left
    [width - 1 - ix, height - 1 - iy],         // bottom-right
  ];

  return positions.map(([x, y]) => {
    const i = (y * width + x) * channels;
    return {
      r: raw[i] ?? 0,
      g: raw[i + 1] ?? 0,
      b: raw[i + 2] ?? 0,
      a: channels >= 4 ? (raw[i + 3] ?? 255) : 255,
    };
  });
}

function isNearWhite(s: CornerSample): boolean {
  return s.r >= NEAR_WHITE && s.g >= NEAR_WHITE && s.b >= NEAR_WHITE;
}

function isOpaque(s: CornerSample): boolean {
  return s.a >= ALPHA_OPAQUE;
}

/**
 * Classify a logo by inspecting its 4 corner pixels (inset 2px).
 *
 * Returns one of the LogoClass values. Used to decide whether the logo
 * needs background stripping (we only strip `white_bg_png` and `jpeg_white`).
 */
export async function classifyLogo(buffer: Buffer, contentType: string): Promise<LogoClass> {
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('svg')) return 'svg';

  let image: sharp.Sharp;
  let metadata: sharp.Metadata;
  let raw: { data: Buffer; info: sharp.OutputInfo };

  try {
    image = sharp(buffer);
    metadata = await image.metadata();
    raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return 'unknown';
  }

  const { width, height, channels } = raw.info;
  if (!width || !height || !channels) return 'unknown';

  const corners = sampleCorners(raw.data, width, height, channels);
  const allOpaque = corners.every(isOpaque);
  const allNearWhite = corners.every(isNearWhite);

  const format = (metadata.format || '').toLowerCase();
  const isPng = format === 'png' || ct.includes('png');
  const isJpeg = format === 'jpeg' || format === 'jpg' || ct.includes('jpeg') || ct.includes('jpg');

  if (isJpeg) {
    return allNearWhite ? 'jpeg_white' : 'jpeg_other';
  }

  if (isPng) {
    if (!allOpaque) {
      // Some corners transparent — could be fully transparent or mixed
      const anyOpaque = corners.some(isOpaque);
      if (!anyOpaque) return 'transparent_png';
      return 'mixed_png';
    }
    // All corners opaque
    if (allNearWhite) return 'white_bg_png';
    return 'opaque_color_png';
  }

  // Other formats (gif, webp, etc.)
  if (isJpeg) return allNearWhite ? 'jpeg_white' : 'jpeg_other';
  if (allOpaque && allNearWhite) return 'white_bg_png';
  return 'unknown';
}

/**
 * Strip the white background from an image by flood-filling from every edge
 * pixel that is near-white. Connected near-white pixels get alpha=0; intentional
 * white inside the logo (text, highlights) is preserved.
 *
 * Returns PNG bytes.
 */
export async function stripWhiteBackground(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height) {
    throw new Error('Cannot strip background: invalid image dimensions');
  }
  const chan = channels || 4;

  // Working copy
  const out = Buffer.from(data);

  // Visited bitmap (1 byte per pixel — simple and fast for typical logo sizes)
  const visited = new Uint8Array(width * height);

  const isNearWhitePx = (idx: number): boolean => {
    const r = out[idx];
    const g = out[idx + 1];
    const b = out[idx + 2];
    return r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE;
  };

  // Seed queue with every edge pixel that is near-white
  // Use a simple array as a queue with a head pointer to avoid O(n) shift().
  const queue: number[] = [];
  const enqueueIfWhite = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    const idx = p * chan;
    if (!isNearWhitePx(idx)) return;
    visited[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < width; x++) {
    enqueueIfWhite(x, 0);
    enqueueIfWhite(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueIfWhite(0, y);
    enqueueIfWhite(width - 1, y);
  }

  // BFS (4-connectivity)
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    // Mark transparent on the output
    const idx = p * chan;
    out[idx + 3] = 0;

    // Neighbors
    if (x > 0) {
      const np = p - 1;
      if (!visited[np]) {
        const nIdx = np * chan;
        if (isNearWhitePx(nIdx)) {
          visited[np] = 1;
          queue.push(np);
        }
      }
    }
    if (x < width - 1) {
      const np = p + 1;
      if (!visited[np]) {
        const nIdx = np * chan;
        if (isNearWhitePx(nIdx)) {
          visited[np] = 1;
          queue.push(np);
        }
      }
    }
    if (y > 0) {
      const np = p - width;
      if (!visited[np]) {
        const nIdx = np * chan;
        if (isNearWhitePx(nIdx)) {
          visited[np] = 1;
          queue.push(np);
        }
      }
    }
    if (y < height - 1) {
      const np = p + width;
      if (!visited[np]) {
        const nIdx = np * chan;
        if (isNearWhitePx(nIdx)) {
          visited[np] = 1;
          queue.push(np);
        }
      }
    }
  }

  // Re-encode as PNG
  const png = await sharp(out, {
    raw: { width, height, channels: chan as 1 | 2 | 3 | 4 },
  })
    .png()
    .toBuffer();

  return png;
}
