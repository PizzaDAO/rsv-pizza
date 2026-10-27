// sfincione-40417: shared helpers for the Pizza Price Index UI (review, index, public page).
import type { PizzaShape, PizzaSizeLadder } from './api';

export const LADDER_SIZES = ['25', '30', '35', '40'] as const;
export const IN_TO_CM = 2.54;

export function roundAreaCm2(diameterCm: number): number {
  const r = diameterCm / 2;
  return Math.PI * r * r;
}

export interface SizeDims {
  shape: PizzaShape;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
}

/** Mirrors backend computeAreaCm2; null when dims are incomplete. */
export function areaFromDims(d: SizeDims): number | null {
  if (d.shape === 'round') return d.diameterCm && d.diameterCm > 0 ? roundAreaCm2(d.diameterCm) : null;
  if (d.shape === 'rect') return d.lengthCm && d.widthCm && d.lengthCm > 0 && d.widthCm > 0 ? d.lengthCm * d.widthCm : null;
  if (d.shape === 'slice') {
    return d.diameterCm && d.diameterCm > 0 && d.sliceFraction && d.sliceFraction > 0 && d.sliceFraction <= 1
      ? roundAreaCm2(d.diameterCm) * d.sliceFraction
      : null;
  }
  return null;
}

export function ladderFromPerCm2(perCm2: number | null): PizzaSizeLadder | null {
  if (perCm2 === null || !Number.isFinite(perCm2)) return null;
  const out = {} as PizzaSizeLadder;
  for (const s of LADDER_SIZES) out[s] = perCm2 * roundAreaCm2(Number(s));
  return out;
}

export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `$${v.toFixed(digits)}`;
}

/** USD per cm^2 is tiny (~0.01-0.05): show 4 decimals. */
export function fmtPerCm2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `$${v.toFixed(4)}`;
}

export function fmtLocal(v: number | null | undefined, currency: string | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `${v.toFixed(digits)}${currency ? ` ${currency}` : ''}`;
}

/** Local per-cm^2 is currency dependent (can be ~0.0003 for COP or 1+ for JPY): adaptive decimals. */
export function fmtLocalPerCm2(v: number | null | undefined, currency: string | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  const digits = v >= 10 ? 2 : v >= 1 ? 3 : 4;
  return `${v.toFixed(digits)}${currency ? ` ${currency}` : ''}`;
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
