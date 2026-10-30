/**
 * sfincione-40417 (pizza count): pure helpers behind ReceiptPizzaCountFields
 * (state picker, count input parsing, size select mapping).
 */

export type PizzaSource = 'ocr' | 'llm' | 'host';

export interface PizzaCountFieldsLike {
  pizzaCount?: number | null;
  pizzaCountSource?: PizzaSource | null;
  pizzaCountConfidence?: number | null;
  pizzaSizeCm?: number | null;
  pizzaSizeLabel?: string | null;
  pizzaSizeSource?: PizzaSource | null;
}

/** Auto-read counts at or above this confidence are shown as "We read N pizzas". */
export const AUTO_SHOW_CONFIDENCE = 0.7;
export const MAX_PIZZA_COUNT = 5000;

/** Host-selectable sizes: cm, with the inch name pizzerias use. */
export const PIZZA_SIZE_OPTIONS = [
  { cm: 25, inch: 10 },
  { cm: 30, inch: 12 },
  { cm: 35, inch: 14 },
  { cm: 40, inch: 16 },
  { cm: 45, inch: 18 },
] as const;

export type PizzaCountView = 'host' | 'auto' | 'prompt';

/**
 * Which of the three UI states a receipt is in.
 *  - host:   the host (or an admin) entered/confirmed a count -> read-only line + Edit
 *  - auto:   OCR/LLM read a count with confidence >= 0.7 -> "We read N pizzas" + Edit
 *  - prompt: nothing, a host-cleared count, or a low-confidence auto read -> amber prompt + inputs
 */
export function pickPizzaCountView(d: PizzaCountFieldsLike): PizzaCountView {
  if (d.pizzaCountSource === 'host' && d.pizzaCount != null) return 'host';
  if (
    d.pizzaCount != null &&
    (d.pizzaCountSource === 'ocr' || d.pizzaCountSource === 'llm') &&
    (d.pizzaCountConfidence ?? 0) >= AUTO_SHOW_CONFIDENCE
  ) {
    return 'auto';
  }
  return 'prompt';
}

/** A low-confidence auto count, offered as a placeholder hint ("About 20 pizzas?"), never as the value. */
export function lowConfidenceHint(d: PizzaCountFieldsLike): number | null {
  if (d.pizzaCount == null) return null;
  if (d.pizzaCountSource === 'host') return null;
  return pickPizzaCountView(d) === 'prompt' ? d.pizzaCount : null;
}

/** Parse the count input. '' / 0 -> null (clear); digits out of 1..5000 or non-digits -> 'invalid'. */
export function parseCountInput(raw: string): number | null | 'invalid' {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,6}$/.test(s)) return 'invalid';
  const n = parseInt(s, 10);
  if (n === 0) return null;
  if (n > MAX_PIZZA_COUNT) return 'invalid';
  return n;
}

/** Keep digits only while typing. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 4);
}

export type PizzaSizeSummary =
  | { kind: 'cm'; cm: number }
  | { kind: 'mixed' }
  | { kind: 'word'; word: string }
  | null;

export function summarizeSize(d: PizzaCountFieldsLike): PizzaSizeSummary {
  if (d.pizzaSizeCm != null) return { kind: 'cm', cm: d.pizzaSizeCm };
  if (d.pizzaSizeLabel === 'mixed') return { kind: 'mixed' };
  if (d.pizzaSizeLabel) return { kind: 'word', word: d.pizzaSizeLabel };
  return null;
}

/** Value of the native <select>: '' (none), 'mixed', or the cm as a string. */
export function sizeSelectValue(d: PizzaCountFieldsLike): string {
  if (d.pizzaSizeCm != null) return String(d.pizzaSizeCm);
  if (d.pizzaSizeLabel === 'mixed') return 'mixed';
  return '';
}

/** Request body for a <select> change. '' clears, 'mixed' flags mixed sizes, else the cm. */
export function sizeSelectToBody(value: string): { pizzaSizeCm?: number | null; pizzaSizeMixed?: boolean } {
  if (value === 'mixed') return { pizzaSizeMixed: true };
  if (value === '') return { pizzaSizeCm: null };
  return { pizzaSizeCm: Number(value) };
}

export function isStandardSize(cm: number): boolean {
  return PIZZA_SIZE_OPTIONS.some((o) => o.cm === cm);
}

/** Admin/index display: "20 pizzas · 35 cm". */
export function formatPizzaChip(d: PizzaCountFieldsLike): string | null {
  if (d.pizzaCount == null) return null;
  const parts = [`${d.pizzaCount} pizza${d.pizzaCount === 1 ? '' : 's'}`];
  const sz = summarizeSize(d);
  if (sz?.kind === 'cm') parts.push(`${sz.cm} cm`);
  else if (sz?.kind === 'mixed') parts.push('mixed sizes');
  else if (sz?.kind === 'word') parts.push(sz.word);
  return parts.join(' · ');
}

export const PIZZA_SOURCE_LABEL: Record<PizzaSource, string> = { ocr: 'OCR', llm: 'AI', host: 'host' };

/** The lump-sum pill text for an underboss queue line, parsed from `notes` ("lump_sum:<src>:<base>"). */
export function lumpSumPill(line: { sourceCategory?: string | null; notes?: string | null }): string | null {
  if (line.sourceCategory !== 'lump_sum') return null;
  const m = /^lump_sum:(ocr|llm|host):/.exec(line.notes ?? '');
  const src = m ? PIZZA_SOURCE_LABEL[m[1] as PizzaSource] : null;
  return src ? `Lump sum (count from ${src})` : 'Lump sum';
}
