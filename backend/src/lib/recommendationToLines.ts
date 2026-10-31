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
  /** Resolver text built from the facts below (see lineText). Recomputed after a menu fit. */
  text: string;
  quantity: number;
  diameter: number | null;
  sizeName: string;
  /** Whole-pizza toppings (empty for cheese or half-and-half). */
  toppings: string[];
  /** [left, right] topping names for a half-and-half. */
  halves: [string[], string[]] | null;
  /** The recommendation's style (New York, Detroit...). Kept for display only: generic menus have no style. */
  style: string;
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
    .slice(0, max); // brand-check-ignore-line (OPOP client id / issuer, fixed by the trust contract) // brand-check-ignore-line (OPOP client id / issuer, fixed by the trust contract)
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

/**
 * Resolver text: "<n> <d>in pizza with X and Y", "<n> <d>in cheese pizza" or
 * "<n> <d>in pizza half X half Y". The style is NOT part of it: the resolver does not know
 * "New York" or "Detroit" and rejects the whole line over it (7 of 39 realistic lines resolved
 * before this change).
 */
export function lineText(l: Pick<OrderLineSpec, 'quantity' | 'diameter' | 'sizeName' | 'toppings' | 'halves'>): string {
  const size = l.diameter ? `${l.diameter}in` : l.sizeName;
  const head = [String(l.quantity), size].filter(Boolean).join(' ');
  if (l.halves) {
    const [left, right] = l.halves;
    return clean(`${head} pizza half ${left.join(' and ') || 'cheese'} half ${right.join(' and ') || 'cheese'}`, 400);
  }
  if (l.toppings.length === 0) return clean(`${head} cheese pizza`, 400);
  return clean(`${head} pizza with ${l.toppings.join(' and ')}`, 400);
}

/** One recommendation -> one line spec. Throws RecommendationError on unusable input. */
export function recommendationToLine(rec: RecommendationInput): OrderLineSpec {
  const ref = clean(rec?.id, 100);
  if (!ref) throw new RecommendationError('Recommendation is missing an id', 'INVALID_RECOMMENDATION');
  const rawQty = rec.quantity === undefined || rec.quantity === null ? 1 : rec.quantity;
  if (typeof rawQty !== 'number' || !Number.isInteger(rawQty) || rawQty < 1 || rawQty > 100) {
    throw new RecommendationError(`Invalid quantity for ${ref}`, 'INVALID_RECOMMENDATION');
  }
  const quantity = rawQty;

  const diameterRaw = Number(rec.size?.diameter);
  const diameter = Number.isFinite(diameterRaw) && diameterRaw > 0 ? Math.round(diameterRaw) : null;
  const sizeName = clean(rec.size?.name, 20);

  let dietary: string[];
  let toppings: string[] = [];
  let halves: [string[], string[]] | null = null;
  const own = Array.isArray(rec.dietaryRestrictions) ? rec.dietaryRestrictions : [];
  if (rec.isHalfAndHalf && rec.leftHalf && rec.rightHalf) {
    halves = [toppingNames(rec.leftHalf.toppings), toppingNames(rec.rightHalf.toppings)];
    // either half's firm need makes the whole pie firm: the shop must not substitute either side
    dietary = normalizeDietary([
      ...own,
      ...(Array.isArray(rec.leftHalf.dietaryRestrictions) ? rec.leftHalf.dietaryRestrictions : []),
      ...(Array.isArray(rec.rightHalf.dietaryRestrictions) ? rec.rightHalf.dietaryRestrictions : []),
    ]);
  } else {
    toppings = toppingNames(rec.toppings);
    dietary = normalizeDietary(own);
  }

  const spec: OrderLineSpec = {
    ref,
    text: '',
    quantity,
    diameter,
    sizeName,
    toppings,
    halves,
    style: clean(rec.style?.name, 40),
    dietary_firm: dietary,
    label: clean(rec.label, 80) || null,
  };
  spec.text = lineText(spec);
  return spec;
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
  return JSON.stringify(lines.map((l) => [l.ref, l.quantity, l.diameter, l.sizeName, l.toppings, l.halves, l.dietary_firm]));
}
