/**
 * Unicode-safe fonts for pdf-lib documents.
 *
 * StandardFonts (Helvetica etc.) are WinAnsi-only and THROW on characters such as
 * "ř", "ł", Cyrillic, CJK or emoji ("WinAnsi cannot encode ..."), which 500'd the tax
 * form submit route. We embed a bundled Noto Sans subset (Latin, Latin Ext, Vietnamese,
 * Greek, Cyrillic) via fontkit, and additionally wrap every font so text it cannot
 * render is transliterated (diacritics stripped) or replaced with '?' instead of
 * throwing. Stored form data is never modified; only what is drawn.
 */
import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { NOTO_SANS_REGULAR_B64, NOTO_SANS_BOLD_B64 } from '../assets/notoSansSubset.js';

/**
 * Make `text` renderable given a `canRender(codePointChar)` predicate:
 * NFC -> keep renderable chars -> else NFKD with combining marks stripped -> else '?'.
 */
export function sanitizeForFont(text: string, canRender: (ch: string) => boolean): string {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    if (ch === '\t') { out += ' '; continue; }
    if (ch === '\n' || ch === '\r') { out += ' '; continue; }
    if (ch < ' ' || ch === '\u007f') continue; // other control chars
    if (canRender(ch)) { out += ch; continue; }
    const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (stripped && [...stripped].every(canRender)) { out += stripped; continue; }
    out += canRender('?') ? '?' : '';
  }
  return out;
}

/** Wrap a PDFFont so encodeText / width measurement never throw on unsupported text. */
function makeSafe(font: PDFFont, canRender: (ch: string) => boolean): PDFFont {
  const encodeText = font.encodeText.bind(font);
  const widthOfTextAtSize = font.widthOfTextAtSize.bind(font);
  font.encodeText = (text: string) => encodeText(sanitizeForFont(text, canRender));
  font.widthOfTextAtSize = (text: string, size: number) =>
    widthOfTextAtSize(sanitizeForFont(text, canRender), size);
  return font;
}

export async function embedSafeStandard(doc: PDFDocument, name: StandardFonts): Promise<PDFFont> {
  const font = await doc.embedFont(name);
  const probe = font.encodeText.bind(font);
  const canRender = (ch: string) => {
    try { probe(ch); return true; } catch { return false; }
  };
  return makeSafe(font, canRender);
}

async function embedSafeTtf(doc: PDFDocument, b64: string): Promise<PDFFont> {
  const font = await doc.embedFont(Buffer.from(b64, 'base64'), { subset: true });
  const chars = new Set(font.getCharacterSet());
  return makeSafe(font, (ch) => chars.has(ch.codePointAt(0)!));
}

/**
 * Returns { font, bold } backed by Noto Sans (Unicode). If the TTF cannot be embedded
 * for any reason, falls back to sanitized Helvetica so PDF generation still succeeds.
 */
export async function embedUnicodeFonts(doc: PDFDocument): Promise<{ font: PDFFont; bold: PDFFont }> {
  try {
    doc.registerFontkit(fontkit);
    const font = await embedSafeTtf(doc, NOTO_SANS_REGULAR_B64);
    const bold = await embedSafeTtf(doc, NOTO_SANS_BOLD_B64);
    return { font, bold };
  } catch (err) {
    console.error('[pdfFonts] Noto Sans embed failed, falling back to Helvetica:', err);
    return {
      font: await embedSafeStandard(doc, StandardFonts.Helvetica),
      bold: await embedSafeStandard(doc, StandardFonts.HelveticaBold),
    };
  }
}
