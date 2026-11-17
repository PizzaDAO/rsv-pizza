/**
 * Printable sheet layouts (pure data + math). All geometry is in the layout's own unit
 * (inches or millimetres); the sheet renderers position every label absolutely from this.
 *
 * Avery 5395 source: Avery 5395 / 8395 / 45395 adhesive name badges, 2-1/3" x 3-3/8", 8 per
 * Letter sheet (2 columns x 4 rows) -- label size per Avery's product page
 * (https://www.avery.com/products/namebadges/5395). Margins/gaps (0.55" top & bottom,
 * 0.6875" sides, 0.375" horizontal gap, 0.19" vertical gap) come from
 * https://filesplice.com/?p=5093 because Avery's own template file (Word/Design & Print)
 * could not be fetched here. They are self-consistent (8.5" and 11" both sum exactly) but are
 * NOT verified against Avery's official template -- hosts should run the alignment test page
 * on plain paper before using real label stock.
 */

export type PaperSize = 'letter' | 'a4';
export type SheetUnit = 'in' | 'mm';

export interface SheetLayout {
  id: string;
  labelKey: string;
  page: PaperSize;
  unit: SheetUnit;
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  marginTop: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
  kind: 'label-stock' | 'plain-paper';
}

export const LETTER = { w: 8.5, h: 11 };
export const A4 = { w: 210, h: 297 };

const AVERY_5395_GRID = {
  page: 'letter' as const,
  unit: 'in' as const,
  pageW: LETTER.w,
  pageH: LETTER.h,
  cols: 2,
  rows: 4,
  labelW: 3.375,
  labelH: 7 / 3, // 2-1/3"
  marginTop: 0.55,
  marginLeft: 0.6875,
  gapX: 0.375,
  gapY: 0.19,
};

export const BADGE_LAYOUTS: SheetLayout[] = [
  { id: 'avery-5395', labelKey: 'print.nametags.layoutAvery5395', kind: 'label-stock', ...AVERY_5395_GRID },
  { id: 'letter-8up-plain', labelKey: 'print.nametags.layoutLetterPlain', kind: 'plain-paper', ...AVERY_5395_GRID },
  {
    id: 'a4-8up-plain',
    labelKey: 'print.nametags.layoutA4Plain',
    kind: 'plain-paper',
    page: 'a4',
    unit: 'mm',
    pageW: A4.w,
    pageH: A4.h,
    cols: 2,
    rows: 4,
    labelW: 90,
    labelH: 60,
    marginTop: (A4.h - 4 * 60) / 2,
    marginLeft: (A4.w - 2 * 90) / 2,
    gapX: 0,
    gapY: 0,
  },
];

export function getBadgeLayout(id: string): SheetLayout {
  return BADGE_LAYOUTS.find((l) => l.id === id) ?? BADGE_LAYOUTS[0];
}

export function perPage(layout: SheetLayout): number {
  return layout.cols * layout.rows;
}

export function pageCount(total: number, layout: SheetLayout): number {
  return Math.max(1, Math.ceil(total / perPage(layout)));
}

/** Position of label slot `i` (0-based, row-major) within its page, in layout units. */
export function slotPosition(layout: SheetLayout, i: number): { x: number; y: number } {
  const s = i % perPage(layout);
  const col = s % layout.cols;
  const row = Math.floor(s / layout.cols);
  return {
    x: layout.marginLeft + col * (layout.labelW + layout.gapX),
    y: layout.marginTop + row * (layout.labelH + layout.gapY),
  };
}

/** Split items into pages of `perPage(layout)`; always at least one (possibly empty) page. */
export function paginate<T>(items: T[], layout: SheetLayout): T[][] {
  const n = perPage(layout);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += n) pages.push(items.slice(i, i + n));
  return pages.length ? pages : [[]];
}

/** How many blanks to add so the last sheet is full (0 if already full or empty). */
export function fillSheetBlanks(total: number, layout: SheetLayout): number {
  const n = perPage(layout);
  const rem = total % n;
  return total === 0 || rem === 0 ? 0 : n - rem;
}

export function pageDims(page: PaperSize): { w: number; h: number; unit: SheetUnit } {
  return page === 'letter' ? { ...LETTER, unit: 'in' } : { ...A4, unit: 'mm' };
}

/** Table tent: one sheet, folded at the half. */
export function tentDims(page: PaperSize) {
  const d = pageDims(page);
  const safe = d.unit === 'in' ? 0.4 : 10;
  const foldSafe = d.unit === 'in' ? 0.4 : 10;
  return { ...d, foldAt: d.h / 2, safe, foldSafe };
}

export function toPx(v: number, unit: SheetUnit): number {
  return unit === 'in' ? v * 96 : (v * 96) / 25.4;
}

export function toPt(v: number, unit: SheetUnit): number {
  return unit === 'in' ? v * 72 : (v * 72) / 25.4;
}

/** CSS `@page size` value. */
export function pageSizeCss(page: PaperSize): string {
  return page === 'letter' ? '8.5in 11in' : '210mm 297mm';
}

/** Letter for US/CA/MX-ish locales, A4 elsewhere. */
export function defaultPaper(locale: string | undefined): PaperSize {
  const l = (locale || '').toLowerCase();
  return ['en-us', 'en-ca', 'es-mx', 'fr-ca'].includes(l) ? 'letter' : 'a4';
}
