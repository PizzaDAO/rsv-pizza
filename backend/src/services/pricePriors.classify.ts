/**
 * basil-14648 P2 (price priors): plain vs specialty, from the receipt line name.
 *
 * Receipts carry no topping counts, so the export uses two classes, encoded the
 * way pizza-mcp's estimate.ts reads `topping_count`:
 *   0 = plain     (cheese, margherita, marinara, mozzarella, ...) and NO other ingredient word
 *   2 = specialty (everything else; "treated as 2 toppings", the median receipt pizza)
 *
 * Deterministic and conservative: anything we cannot read as plain is specialty.
 * Size, quantity, shape and filler words ("pizza", "large", "14 inch", "P.") are
 * ignored. Multi-cheese pies ("3 cheese", "quattro formaggi") are specialty.
 */

export type PriorClass = 0 | 2;
export const PLAIN = 0 as const;
export const SPECIALTY = 2 as const;

/** Words that make a pie plain (en / es / pt / it / fr). */
const PLAIN_WORDS = new Set([
  'cheese', 'plain', 'margherita', 'margarita', 'margherite', 'marinara',
  'mozzarella', 'mozzarela', 'muzzarella', 'muzzarela', 'mussarela', 'mussarella', 'muzza',
  'queso', 'quesos', 'formaggio', 'fromage', 'queijo',
]);

/** Words that say nothing about toppings: sizes, shapes, styles, quantities, filler. */
const FILLER = new Set([
  'pizza', 'pizzas', 'pie', 'pies', 'p', 'pza', 'pz',
  'small', 'sm', 's', 'medium', 'med', 'md', 'm', 'large', 'lg', 'lrg', 'l', 'xl', 'xxl', 'x', 'big',
  'personal', 'individual', 'family', 'familiar', 'mega', 'jumbo', 'giant', 'party', 'regular', 'reg',
  'grande', 'mediana', 'media', 'pequena', 'chica', 'grand', 'petite', 'piccola',
  'inch', 'inches', 'in', 'cm', 'whole', 'entera', 'inteira', 'half', 'slice', 'slices',
  'round', 'thin', 'crust', 'classic', 'classica', 'classico', 'classique', 'original', 'traditional', 'tradicional',
  'style', 'new', 'york', 'ny', 'nyc', 'neapolitan', 'napoletana', 'napolitana',
  'the', 'a', 'of', 'and', 'with', 'de', 'di', 'da', 'do', 'la', 'le', 'el', 'com', 'con', 'avec', 'e', 'y', 'et',
  'serves', 'serve', 'promo', 'combo', 'only',
]);

/** Multi-cheese pies are priced like specialties. */
const MULTI_CHEESE = /\b(\d+|two|three|four|five|tre|quattro|cuatro|quatro|quatre|tres|trois)\s*-?\s*(cheese|cheeses|formaggi|formaggio|quesos|queijos|fromages)\b/;

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function classifyPizzaName(rawName: string | null | undefined): PriorClass {
  if (!rawName) return SPECIALTY;
  const s = fold(rawName);
  if (MULTI_CHEESE.test(s)) return SPECIALTY;
  const tokens = s
    .replace(/\bextra[\s-]*(large|big|grande)\b/g, ' ') // a size, not "extra cheese"
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !/^\d+$/.test(t) && !/^\d+(in|cm|x)$/.test(t) && !/^x\d+$/.test(t));
  let plainSeen = false;
  for (const t of tokens) {
    if (PLAIN_WORDS.has(t)) {
      plainSeen = true;
      continue;
    }
    if (FILLER.has(t)) continue;
    return SPECIALTY; // any other word is an ingredient (or a named specialty)
  }
  return plainSeen ? PLAIN : SPECIALTY;
}
