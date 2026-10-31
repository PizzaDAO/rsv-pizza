/**
 * basil-14648: turn the party's pizza recommendations into free-text order lines that
 * pizza-mcp's resolver (POST /pizzerias/{id}/menu/resolve) maps onto ANY shop's menu, plus the
 * per-line facts OPOP wants beside the text (quantity, dietary_firm, label, client_line_ref).
 *
 * Text shape (plan §10): "<quantity> <diameter>in <style> <toppings>", or
 * "<quantity> <diameter>in <style> half X half Y" for half-and-half. Beverages are not sent
 * in v1 (the host buys them separately).
 */

export interface RecTopping {
  name: string;
}
export interface RecHalf {
  toppings: RecTopping[];
  dietaryRestrictions?: string[];
}
export interface RecommendationInput {
  id: string;
  quantity?: number;
  size?: { diameter?: number; name?: string };
  style?: { name?: string };
  toppings?: RecTopping[];
  dietaryRestrictions?: string[];
  label?: string;
  isHalfAndHalf?: boolean;
  leftHalf?: RecHalf;
  rightHalf?: RecHalf;
}

export interface OrderLineSpec {
  /** The recommendation id; echoed back by OPOP as client_line_ref. */
  ref: string;
  text: string;
  quantity: number;
  dietary_firm: string[];
  label: string | null;
}

export const MAX_RECOMMENDATIONS = 40;
export const MAX_PIZZAS_PER_ORDER = 30; // plan §7.6: bigger means "call them yourself"

const DIETARY_ALLOWED = new Set(['vegan', 'vegetarian', 'gluten_free', 'dairy_free', 'nut_free', 'kosher', 'halal']);

/** Collapse whitespace, drop control characters and anything that could pass for markup. */
function clean(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\u0000-\u001f\u007f<>`{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function normalizeDietary(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const k = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    // rsv.pizza spells it "gluten-free" / "Gluten Free"; anything unknown is dropped, never guessed.
    if (DIETARY_ALLOWED.has(k)) out.add(k);
  }
  return Array.from(out).slice(0, 8);
}

function toppingNames(list: RecTopping[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((t) => clean(t?.name, 40)).filter(Boolean);
}

export class RecommendationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/** One recommendation -> one line spec. Throws RecommendationError on unusable input. */
export function recommendationToLine(rec: RecommendationInput): OrderLineSpec {
  const ref = clean(rec?.id, 100);
  if (!ref) throw new RecommendationError('Recommendation is missing an id', 'INVALID_RECOMMENDATION');
  const quantity = Number.isInteger(rec.quantity) ? (rec.quantity as number) : 1;
  if (quantity < 1 || quantity > 100) {
    throw new RecommendationError(`Invalid quantity for ${ref}`, 'INVALID_RECOMMENDATION');
  }

  const parts: string[] = [String(quantity)];
  const diameter = Number(rec.size?.diameter);
  if (Number.isFinite(diameter) && diameter > 0) parts.push(`${Math.round(diameter)}in`);
  else if (clean(rec.size?.name, 20)) parts.push(clean(rec.size?.name, 20));
  const style = clean(rec.style?.name, 40);
  if (style) parts.push(style);

  let dietary: string[];
  if (rec.isHalfAndHalf && rec.leftHalf && rec.rightHalf) {
    const left = toppingNames(rec.leftHalf.toppings);
    const right = toppingNames(rec.rightHalf.toppings);
    parts.push(`half ${left.join(' ') || 'cheese'} half ${right.join(' ') || 'cheese'}`);
    // either half's firm need makes the whole pie firm: the shop must not substitute either side
    dietary = normalizeDietary([
      ...(rec.dietaryRestrictions ?? []),
      ...(rec.leftHalf.dietaryRestrictions ?? []),
      ...(rec.rightHalf.dietaryRestrictions ?? []),
    ]);
  } else {
    const t = toppingNames(rec.toppings);
    parts.push(t.length ? t.join(' ') : 'cheese');
    dietary = normalizeDietary(rec.dietaryRestrictions);
  }

  return {
    ref,
    text: clean(parts.join(' '), 400),
    quantity,
    dietary_firm: dietary,
    label: clean(rec.label, 80) || null,
  };
}

/** All recommendations -> line specs, enforcing the phone-order size cap. */
export function recommendationsToLines(recs: unknown): OrderLineSpec[] {
  if (!Array.isArray(recs) || recs.length === 0) {
    throw new RecommendationError('No pizza recommendations to order', 'NO_RECOMMENDATIONS');
  }
  if (recs.length > MAX_RECOMMENDATIONS) {
    throw new RecommendationError('Too many pizza lines', 'TOO_MANY_LINES');
  }
  const lines = recs.map((r) => recommendationToLine(r as RecommendationInput));
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  if (total > MAX_PIZZAS_PER_ORDER) {
    throw new RecommendationError(
      `${total} pizzas is too many for an automated order (max ${MAX_PIZZAS_PER_ORDER}). Call the shop yourself.`,
      'TOO_MANY_PIZZAS'
    );
  }
  return lines;
}

/**
 * Stable fingerprint of what is being ordered. Part of the order idempotency key, so the same
 * recommendations at the same shop replay, and a changed recommendation is a new order.
 */
export function recommendationVersion(lines: OrderLineSpec[]): string {
  return JSON.stringify(lines.map((l) => [l.ref, l.text, l.quantity, l.dietary_firm]));
}
