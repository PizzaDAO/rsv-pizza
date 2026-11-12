/**
 * basil-14648 P2 (host menus): what rsv checks about a menu upload BEFORE anything is forwarded to pizza-mcp.
 *
 * pizza-mcp checks all of this again (upload-sniff.ts there), plus the image dimensions and the PDF page count. rsv
 * refuses early so a file pizza-mcp would refuse never leaves this server, and so the 4 MB total (under Vercel's
 * 4.5 MB request limit on both hops) is enforced here too. The declared type of a part (its Content-Type, its file
 * name) is ignored: only the first bytes decide.
 *
 * No dependency: the four signatures are fixed.
 */

export type MenuMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const MENU_UPLOAD_LIMITS = {
  /** Total decoded bytes across every file (pizza-mcp's own limit). */
  maxTotalBytes: 4 * 1024 * 1024,
  /** The whole multipart body: the files plus the framing. Under Vercel's 4.5 MB body limit. */
  maxBodyBytes: Math.floor(4.5 * 1024 * 1024),
  maxImages: 3,
  maxPdfs: 1,
  maxUrlChars: 500,
} as const;

/** The type the first bytes say, or null for anything that is not one of the four accepted types. */
export function sniffMenuMime(b: Uint8Array): MenuMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf'; // %PDF-
  return null;
}

export interface SniffedMenuFile {
  bytes: Buffer;
  mime: MenuMime;
}

export type MenuUploadCheck =
  | { ok: true; files: SniffedMenuFile[] }
  | { ok: false; code: 'MENU_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'VALIDATION_FAILED'; status: 400 | 413 | 415; message: string };

/** Up to 3 photos, or exactly 1 PDF on its own; 4 MB in total; no empty file; types from the bytes only. */
export function checkMenuUpload(files: Buffer[]): MenuUploadCheck {
  if (files.length === 0) {
    return { ok: false, code: 'VALIDATION_FAILED', status: 400, message: 'Add a photo or a PDF of the menu.' };
  }
  if (files.length > MENU_UPLOAD_LIMITS.maxImages) {
    return { ok: false, code: 'MENU_TOO_LARGE', status: 413, message: 'Send at most 3 photos of the menu.' };
  }
  const total = files.reduce((n, f) => n + f.length, 0);
  if (total > MENU_UPLOAD_LIMITS.maxTotalBytes) {
    return { ok: false, code: 'MENU_TOO_LARGE', status: 413, message: 'The menu files are larger than 4 MB in total.' };
  }
  const out: SniffedMenuFile[] = [];
  for (const bytes of files) {
    if (bytes.length === 0) {
      return { ok: false, code: 'VALIDATION_FAILED', status: 400, message: 'One of the files is empty.' };
    }
    const mime = sniffMenuMime(bytes);
    if (!mime) {
      return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, message: 'Use a JPEG, PNG or WebP photo, or a PDF.' };
    }
    out.push({ bytes, mime });
  }
  const pdfs = out.filter((f) => f.mime === 'application/pdf').length;
  if (pdfs > 0 && out.length > 1) {
    return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, message: 'Send one PDF on its own, or up to 3 photos.' };
  }
  return { ok: true, files: out };
}

/**
 * A menu link as the host pasted it: http or https, no user name or password, at most 500 characters. pizza-mcp
 * does the real network checks (public addresses only, redirects re-checked, the per-site opt-out).
 */
export function checkMenuUrl(raw: unknown): { ok: true; url: string } | { ok: false; message: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, message: 'Paste a link to the menu.' };
  if (s.length > MENU_UPLOAD_LIMITS.maxUrlChars) return { ok: false, message: 'That link is too long (500 characters at most).' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, message: 'That doesn\'t look like a link. Paste the whole address, starting with https://' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: 'Use a link that starts with https://' };
  if (u.username || u.password) return { ok: false, message: 'Use a link without a user name or password in it.' };
  return { ok: true, url: u.toString() };
}
