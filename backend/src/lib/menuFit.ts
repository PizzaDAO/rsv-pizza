/**
 * basil-14648: fit a recommendation line to ONE shop's menu before asking the resolver.
 *
 *  - size: pick the shop's nearest offered diameter (18in and 20in do not exist on a generic menu);
 *    the change is reported as a notice, never silent.
 *  - toppings: match each recommended topping to a topping the shop actually lists (case, accents,
 *    plurals, a few common aliases: "bell peppers" -> "Green peppers", "olives" -> "Black olives").
 *    Anything left over is `unmatched` and becomes a choice for the host (leave it off, or skip the line).
 * Pure functions over the OPOP menu shape, no I/O.
 */
import type { OrderLineSpec } from './recommendationToLines.js';
import { lineText } from './recommendationToLines.js';

interface MenuLike {
  categories?: Array<{
    items?: Array<{
      kind?: string;
      sizes?: Array<{ diameter_in?: number | null; available?: boolean; name?: string }>;
      option_groups?: Array<{ role?: string; name?: string; options?: Array<{ name: string; available?: boolean }> }>;
    }>;
  }>;
}

export interface MenuFacts {
  diameters: number[];
  toppings: string[];
}

export function menuFacts(menu: MenuLike): MenuFacts {
  const diameters = new Set<number>();
  const toppings = new Set<string>();
  for (const c of menu.categories ?? []) {
    for (const it of c.items ?? []) {
      for (const s of it.sizes ?? []) {
        if (s.available !== false && typeof s.diameter_in === 'number' && s.diameter_in > 0) diameters.add(s.diameter_in);
      }
      for (const g of it.option_groups ?? []) {
        if (!(g.role === 'topping' || /topping/i.test(g.name ?? ''))) continue;
        for (const o of g.options ?? []) if (o.available !== false) toppings.add(o.name);
      }
    }
  }
  return { diameters: [...diameters].sort((a, b) => a - b), toppings: [...toppings] };
}

const ALIASES: Record<string, string> = {
  'bell pepper': 'green pepper',
  'pepper': 'green pepper',
  'green pepper': 'green pepper',
  'olive': 'black olive',
  'black olive': 'black olive',
  'extra cheese': 'extra cheese',
  'italian sausage': 'sausage',
  'canadian bacon': 'ham',
};

function norm(s: string): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // singularise each word: "mushrooms" -> "mushroom", "peppers" -> "pepper"
  const single = base
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
  return ALIASES[single] ?? single;
}

/** The shop's own name for a recommended topping, or null when it is not on the menu. */
export function matchTopping(want: string, menuToppings: string[]): string | null {
  const w = norm(want);
  if (!w) return null;
  const table = menuToppings.map((t) => ({ t, n: norm(t) }));
  return (table.find((x) => x.n === w) ?? table.find((x) => ` ${x.n} `.includes(` ${w} `) || ` ${w} `.includes(` ${x.n} `)))?.t ?? null;
}

export interface FitResult {
  spec: OrderLineSpec;
  /** Recommended toppings this shop does not list. */
  unmatched: string[];
  notices: string[];
}

export function fitLine(spec: OrderLineSpec, facts: MenuFacts, opts: { omit?: boolean } = {}): FitResult {
  const notices: string[] = [];
  const unmatched: string[] = [];
  let diameter = spec.diameter;
  if (diameter && facts.diameters.length && !facts.diameters.includes(diameter)) {
    // nearest offered size; on a tie prefer the larger pie (feeds more people)
    const nearest = [...facts.diameters].sort((a, b) => Math.abs(a - diameter!) - Math.abs(b - diameter!) || b - a)[0];
    notices.push(`This shop has no ${diameter}" pizza; ordering the ${nearest}" instead.`);
    diameter = nearest;
  }
  const fit = (names: string[]) => {
    const out: string[] = [];
    for (const n of names) {
      const hit = facts.toppings.length ? matchTopping(n, facts.toppings) : n; // no topping list: pass through
      if (hit) out.push(hit);
      else {
        unmatched.push(n);
        if (!opts.omit) out.push(n);
      }
    }
    return out;
  };
  const toppings = fit(spec.toppings);
  const halves = spec.halves ? ([fit(spec.halves[0]), fit(spec.halves[1])] as [string[], string[]]) : null;
  const next: OrderLineSpec = { ...spec, diameter, toppings, halves };
  next.text = lineText(next);
  return { spec: next, unmatched, notices };
}
