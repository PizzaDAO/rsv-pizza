import { describe, it, expect } from 'vitest';
import { BADGE_LAYOUTS, getBadgeLayout, slotPosition, paginate, pageCount, perPage, fillSheetBlanks, defaultPaper, tentDims } from './layouts';

describe('badge layouts', () => {
  it.each(BADGE_LAYOUTS.map((l) => [l.id, l] as const))('%s grid fits the page', (_id, l) => {
    const w = l.marginLeft * 2 + l.cols * l.labelW + (l.cols - 1) * l.gapX;
    const h = l.marginTop * 2 + l.rows * l.labelH + (l.rows - 1) * l.gapY;
    const tol = l.unit === 'in' ? 0.02 : 0.5;
    expect(Math.abs(w - l.pageW)).toBeLessThanOrEqual(tol);
    expect(Math.abs(h - l.pageH)).toBeLessThanOrEqual(tol);
  });

  it('Avery 5395 slot positions', () => {
    const l = getBadgeLayout('avery-5395');
    expect(slotPosition(l, 0)).toEqual({ x: 0.6875, y: 0.55 });
    expect(slotPosition(l, 1).x).toBeCloseTo(0.6875 + 3.375 + 0.375);
    expect(slotPosition(l, 7).y).toBeCloseTo(0.55 + 3 * (7 / 3 + 0.19));
    expect(slotPosition(l, 8)).toEqual(slotPosition(l, 0)); // next page
  });

  it('paginates ceil(N / perPage) pages', () => {
    const l = getBadgeLayout('avery-5395');
    expect(perPage(l)).toBe(8);
    for (const n of [0, 1, 8, 9, 17]) {
      expect(paginate(Array.from({ length: n }), l).length).toBe(Math.max(1, Math.ceil(n / 8)));
      expect(pageCount(n, l)).toBe(Math.max(1, Math.ceil(n / 8)));
    }
  });

  it('fill-sheet blank maths', () => {
    const l = getBadgeLayout('a4-8up-plain');
    expect(fillSheetBlanks(0, l)).toBe(0);
    expect(fillSheetBlanks(8, l)).toBe(0);
    expect(fillSheetBlanks(9, l)).toBe(7);
    expect(fillSheetBlanks(15, l)).toBe(1);
  });

  it('unknown layout falls back to Avery 5395', () => {
    expect(getBadgeLayout('nope').id).toBe('avery-5395');
  });

  it('default paper by locale; tent folds at half', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('de')).toBe('a4');
    expect(tentDims('letter').foldAt).toBe(5.5);
    expect(tentDims('a4').foldAt).toBe(148.5);
  });
});
