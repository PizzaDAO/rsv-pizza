/**
 * CSV export helpers (plans/hackathon-platform.md §4, §16 Q7). Pure, unit-tested.
 * Participant-entered text is untrusted: any cell starting with = + - @ (or a tab / CR, which
 * some spreadsheet apps also treat as a formula lead-in) is prefixed with a single quote so
 * Excel / Sheets / Numbers show it as text instead of evaluating it (CSV / formula injection).
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const BOM = '﻿';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('; ') : String(v);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (names with accents) correctly.
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
