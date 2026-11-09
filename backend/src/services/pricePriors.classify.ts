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

/**
 * Multi-cheese pies are priced like specialties: 3-5 as a bare number ("3 Cheese"), the words two to five (en/it/es/
 * pt/fr), "multi", or a hyphenated 2-5 ("2-cheese", "4-cheese"). A bare "2 Cheese" is ambiguous (two cheese pizzas on
 * an OCR line), so it stays plain. Size numbers never match: "14 Cheese", "18 Cheese" and "12\" cheese" are plain
 * (a number of 6+ or one glued to other digits is not a cheese count).
 */
const CHEESE_WORD = '(?:cheese|cheeses|formaggi|formaggio|queso|quesos|queijo|queijos|fromage|fromages)';
const MULTI_CHEESE = new RegExp(
  `(?:(?<![0-9./])[345]\\s*-?\\s*|(?<![0-9./])[2-5]-\\s*|\\b(?:two|three|four|five|tre|quattro|dos|tres|cuatro|quatro|cinco|deux|trois|quatre|cinq|multi)\\s*-?\\s*)${CHEESE_WORD}\\b`,
);

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
