/**
 * sfincione-40417: pizza size parsing + resolution for the Pizza Price Index.
 *
 * Pure functions only (no DB, no network) so they are trivially testable.
 *
 * Resolver order (first hit wins; every hit records size_source/confidence):
 *   1. parse   - explicit dimensions printed on the line      (parsed, 0.95)
 *   2. presets - merchant (0.85) > chain (0.80) > country (0.60) > global (0.50)
 *   3/4. LLM text / vision passes live in pizzaIndexLlm.service.ts
 */

export const STANDARD_SIZES_CM = [25, 30, 35, 40] as const;
export type StandardSizeCm = (typeof STANDARD_SIZES_CM)[number];

export type PizzaShape = 'round' | 'rect' | 'slice';
export type SizeSource = 'parsed' | 'preset' | 'llm' | 'web' | 'manual';

/** Round pizza diameters outside this range are treated as misparses. */
export const MIN_ROUND_DIAMETER_CM = 15;
export const MAX_ROUND_DIAMETER_CM = 60;

export const CONFIDENCE = {
  parsed: 0.95,
  merchant: 0.85,
  chain: 0.8,
  country: 0.6,
  global: 0.5,
  llmCap: 0.7,
  visionCap: 0.75,
  manual: 1,
} as const;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function roundArea(diameterCm: number): number {
  const r = diameterCm / 2;
  return Math.PI * r * r;
}

/** Area (cm^2) of the standard ladder sizes: 25/30/35/40 cm. */
export function standardSizeArea(diameterCm: number): number {
  return roundArea(diameterCm);
}

export interface Dimensions {
  shape: PizzaShape | 'other' | null;
  diameterCm?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  /** For shape 'slice', diameterCm is the PARENT pie. */
  sliceFraction?: number | null;
}

/** Area in cm^2 rounded to 0.1, or null if the shape/dimensions are unusable. */
export function computeAreaCm2(d: Dimensions): number | null {
  const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  let area: number | null = null;
  switch (d.shape) {
    case 'round':
      if (pos(d.diameterCm)) area = roundArea(d.diameterCm);
      break;
    case 'rect':
      if (pos(d.lengthCm) && pos(d.widthCm)) area = d.lengthCm * d.widthCm;
      break;
    case 'slice':
      if (pos(d.diameterCm) && pos(d.sliceFraction) && d.sliceFraction <= 1) {
        area = d.sliceFraction * roundArea(d.diameterCm);
      }
      break;
    default:
      area = null;
  }
  if (area === null) return null;
  return Math.round(area * 10) / 10;
}

/** Price of a pizza of the given diameter at the given price per cm^2. */
export function priceForDiameter(perCm2: number, diameterCm: number): number {
  return perCm2 * roundArea(diameterCm);
}

// ---------------------------------------------------------------------------
// Merchant normalization
// ---------------------------------------------------------------------------

/** lower-case, strip diacritics + punctuation, collapse whitespace. */
export function normalizeMerchantKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return k.length > 0 ? k : null;
}

const CHAIN_PATTERNS: Array<[RegExp, string]> = [
  [/\bdomino/, 'dominos'],
  [/\bpizza ?hut\b/, 'pizza hut'],
  [/\bpapa ?john/, 'papa johns'],
  [/\blittle ?caesar/, 'little caesars'],
  [/\bla ?pino ?z\b|\blapinoz\b/, 'la pinoz'],
  [/\boven ?story\b/, 'oven story'],
  [/\bsbarro\b/, 'sbarro'],
  [/\bcosta ?pizza\b/, 'costa pizza'],
];

/** Chain key for well-known chains (regardless of branch suffix), else null. */
export function detectChainKey(merchantKey: string | null | undefined): string | null {
  if (!merchantKey) return null;
  for (const [re, key] of CHAIN_PATTERNS) if (re.test(merchantKey)) return key;
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type SizeLabel =
  | 'personal' | 'small' | 'medium' | 'regular' | 'large' | 'xl' | 'family' | 'mega'
  | 'slice' | 'half' | 'default'
  | string; // literal labels like '33cm'

export interface ParsedSize {
  /** Normalized size word, or a literal like '33cm' for explicit dimensions. */
  label: SizeLabel | null;
  /** Normalized word only (no literal), useful for preset lookup. */
  word: SizeLabel | null;
  shape: PizzaShape | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  /** True when concrete dimensions/shape were printed (conf 0.95). */
  explicit: boolean;
  style: string | null;
}

const IN_TO_CM = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Quote characters that mean "inches": " ” ″ '' ’’
const INCH_MARK = `(?:"|”|“|″|''|’’|‘‘|英寸|吋)`;
const NUM = `(\\d{1,3}(?:[.,]\\d{1,2})?)`;
const toNum = (s: string) => parseFloat(s.replace(',', '.'));

const RECT_RE = new RegExp(
  `${NUM}\\s*(?:x|×|by)\\s*${NUM}\\s*(cm|${INCH_MARK}|in(?:ch(?:es)?)?\\b)`, 'i');
const INCH_RE = new RegExp(
  `${NUM}\\s*-?\\s*(?:${INCH_MARK}|in\\b|inch(?:es)?\\b|pulgadas?\\b|pol\\b|polegadas?\\b|zoll\\b|pouces?\\b)`, 'i');
const CM_RE = new RegExp(`${NUM}\\s*(?:cms?|厘米|公分)(?![a-z])`, 'i');
// Ø / diameter prefix: "Ø 30", "diam. 32 cm" (cm unless an inch mark follows)
const DIAM_RE = new RegExp(`(?:Ø|⌀|\\bdi[aá]m(?:eter|etro)?\\.?)\\s*:?\\s*${NUM}(?!\\s*${INCH_MARK})`, 'i');
// India-style menus: "Large [12] Serves 3" / "Monster [22] Serves 5" => bare bracketed inches
const BRACKET_INCH_RE = /[\[(]\s*(\d{1,2}(?:\.\d)?)\s*[\])]/;
const SERVES_RE = /\bserves?\s*\d/i;

// Multi-letter size words (case-insensitive). Order matters: xl before large.
const WORD_RULES: Array<[RegExp, SizeLabel]> = [
  [/\bmonster\b|怪兽|怪獸/i, 'monster'],
  [/\b(?:x[- ]?large|extra[- ]?large|xlarge|xxl|xl|extra grande)\b/i, 'xl'],
  [/\b(?:family|familiar(?:es)?|familia|jumbo|gigante|giant)\b/i, 'family'],
  [/\bmega\b/i, 'mega'],
  [/\b(?:personal|individual|mini|personnelle?|single)\b/i, 'personal'],
  [/\b(?:small|sm|chica|chico|pequena|pequeno|petite|piccola|kleine?)\b/i, 'small'],
  [/\b(?:medium|mediana|mediano|med|md|media|medio|moyenne?)\b/i, 'medium'],
  [/\bregular\b/i, 'regular'],
  [/\b(?:large|lg|lrg|grande|big|gross)\b/i, 'large'],
];

// Single letters count ONLY when they stand alone after a pizza name:
// preceded by whitespace/paren/dash and followed by end-of-string or a closing
// bracket/paren/comma. Case-sensitive uppercase to avoid "m" in prose.
const SINGLE_LETTER_RE = /(?:^|[\s(\-–,/\[])(S|M|L)(?=\s*[)\]]?\s*$)/;
const SINGLE_LETTER_MAP: Record<string, SizeLabel> = { S: 'small', M: 'medium', L: 'large' };

const STYLE_RULES: Array<[RegExp, string]> = [
  [/\b(?:neapolitan|napoletana|napolitana|napoli)\b/i, 'neapolitan'],
  [/\b(?:new york|nyc|n\.y\.)\b|\bNY\b/i, 'ny'],
  [/\b(?:deep dish|chicago)\b|\bpan\b/i, 'pan'],
  [/\bdetroit\b/i, 'detroit'],
  [/\b(?:sicilian|siciliana|sicilienne|sfincione)\b/i, 'sicilian'],
  [/\b(?:thin crust|thin|crispy|crujiente|fina)\b/i, 'thin'],
];

const SLICE_RE = /\b(?:slice|slices|porci[oó]n|porcion|rebanada|fetta|fette|peda[cç]o|tranche|st[uü]ck)\b/i;
// "12 slices", "8 pcs", "8 porciones": a whole pie described by its slice count.
const SLICE_COUNT_RE = /\b\d{1,2}\s*-?\s*(?:slices?|pcs?|pieces?|porciones|porcoes|fatias|pedazos|fette)\b/i;
const HALF_RE = /(?:^|\s)1\/2(?=\s|$)|\b(?:half|mezza|metade)\s+pizza\b/i;

// Parenthesized trailing codes that are unambiguous in LATAM menus: (G)=grande, (P)=pequena.
const PAREN_CODE_RE = /\(\s*([GP])\s*\)\s*$/;
const PAREN_CODE_MAP: Record<string, SizeLabel> = { G: 'large', P: 'small' };
// "1/1" prefix (Brazil): a whole pie, size unspecified.
const WHOLE_RE = /^\s*1\/1(?=\s|$)/;

function detectWord(name: string): SizeLabel | null {
  for (const [re, label] of WORD_RULES) if (re.test(name)) return label;
  const pc = PAREN_CODE_RE.exec(name);
  if (pc) return PAREN_CODE_MAP[pc[1]];
  if (WHOLE_RE.test(name)) return 'whole';
  const m = SINGLE_LETTER_RE.exec(name);
  if (m) return SINGLE_LETTER_MAP[m[1]];
  return null;
}

function detectStyle(name: string): string | null {
  for (const [re, style] of STYLE_RULES) if (re.test(name)) return style;
  return null;
}

function emptyParsed(): ParsedSize {
  return {
    label: null, word: null, shape: null, diameterCm: null, lengthCm: null,
    widthCm: null, sliceFraction: null, explicit: false, style: null,
  };
}

/** Parse everything a pizza line name tells us about size/shape. */
export function parseSize(name: string | null | undefined): ParsedSize {
  const out = emptyParsed();
  if (!name) return out;
  const text = String(name).replace(/\s+/g, ' ').trim();
  if (!text) return out;

  out.word = detectWord(text);
  out.style = detectStyle(text);
  out.label = out.word;

  // 1. Rectangles: 30x40 cm, 12x18"
  const rect = RECT_RE.exec(text);
  if (rect) {
    const a = toNum(rect[1]);
    const b = toNum(rect[2]);
    const unit = rect[3].toLowerCase();
    const k = unit === 'cm' ? 1 : IN_TO_CM;
    const l = round1(Math.max(a, b) * k);
    const w = round1(Math.min(a, b) * k);
    if (l >= 15 && l <= 150 && w >= 10 && w <= 100) {
      out.shape = 'rect';
      out.lengthCm = l;
      out.widthCm = w;
      out.explicit = true;
      out.label = out.word ?? `${l}x${w}cm`;
      return out;
    }
  }

  // 2. Explicit round diameter in cm, then inches (cm wins when both appear).
  const cmHit = CM_RE.exec(text);
  const inHit = INCH_RE.exec(text);
  const diamHit = DIAM_RE.exec(text);
  const candidates: number[] = [];
  if (cmHit) candidates.push(toNum(cmHit[1]));
  if (inHit) candidates.push(round1(toNum(inHit[1]) * IN_TO_CM));
  if (diamHit && !cmHit) candidates.push(toNum(diamHit[1]));
  // Bare bracketed number next to a size word / "Serves N" is inches (6-30").
  if (candidates.length === 0 && (out.word || SERVES_RE.test(text))) {
    const b = BRACKET_INCH_RE.exec(text);
    if (b) {
      const inch = parseFloat(b[1]);
      if (inch >= 6 && inch <= 30) candidates.push(round1(inch * IN_TO_CM));
    }
  }
  for (const d of candidates) {
    if (d >= MIN_ROUND_DIAMETER_CM && d <= MAX_ROUND_DIAMETER_CM) {
      // A slice of an explicitly sized pie is still a slice; handled below.
      out.diameterCm = round1(d);
      out.shape = 'round';
      out.explicit = true;
      out.label = out.word ?? `${Math.round(d)}cm`;
      break;
    }
  }

  // 3. Half pizza: 1/2 of the (parsed or preset) pie.
  if (HALF_RE.test(text) && !SLICE_RE.test(text)) {
    out.shape = 'slice';
    out.sliceFraction = 0.5;
    out.label = 'half';
    // keep explicit diameter if any (parent pie); otherwise resolver supplies it
    if (out.diameterCm === null) out.explicit = false;
    return out;
  }

  // 4. Slices: a single slice, unless the text is a slice COUNT of a whole pie.
  if (SLICE_RE.test(text) && !SLICE_COUNT_RE.test(text)) {
    out.shape = 'slice';
    out.sliceFraction = null; // resolver fills 1/8 (or preset) unless known
    out.label = 'slice';
    if (out.diameterCm === null) out.explicit = false;
    return out;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bundle / lump-sum detection
// ---------------------------------------------------------------------------

const BUNDLE_RE = new RegExp(
  [
    'all[- ]you[- ]can', 'unlimited', 'ilimitad', 'rod[ií]zio', 'buffet',
    'pizza\\s+libre', 'libre\\s+de\\s+pizza', 'pizza\\s+party', 'party\\s+pack',
    'pizzas?\\s+varias?', 'pizzas?\\s+varios', 'varias\\s+pizzas', 'pizzas?\\s+surtid',
    'barra\\s+libre', 'promoci[oó]n.*libre', 'pizza\\s+combo\\s+x\\s*\\d+',
  ].join('|'),
  'i',
);

/** Heuristic: all-you-can-eat / party packs / lump sums that can't be priced per area. */
export function looksLikeBundle(name: string | null | undefined): boolean {
  return !!name && BUNDLE_RE.test(name);
}

// ---------------------------------------------------------------------------
// Presets + resolver
// ---------------------------------------------------------------------------

export interface SizePreset {
  id: string;
  scope: 'merchant' | 'chain' | 'country' | 'global';
  merchantKey: string | null;
  country: string | null;
  sizeLabel: string;
  shape: PizzaShape;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
}

export interface ResolveContext {
  merchantKey?: string | null;
  country?: string | null;
}

export interface ResolvedSize {
  sizeLabel: string | null;
  shape: PizzaShape | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  areaCm2: number | null;
  sizeSource: SizeSource | null;
  sizeConfidence: number | null;
  presetId: string | null;
  style: string | null;
}

export function unresolved(style: string | null = null, sizeLabel: string | null = null): ResolvedSize {
  return {
    sizeLabel, shape: null, diameterCm: null, lengthCm: null, widthCm: null,
    sliceFraction: null, areaCm2: null, sizeSource: null, sizeConfidence: null,
    presetId: null, style,
  };
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Find the best preset for a label. Precedence merchant > chain > country >
 * global. `default` is tried for merchant/chain/country only when no label.
 */
export function lookupPreset(
  presets: SizePreset[],
  label: string,
  ctx: ResolveContext,
): { preset: SizePreset; confidence: number } | null {
  const l = norm(label);
  const mk = ctx.merchantKey ? norm(ctx.merchantKey) : null;
  const chain = detectChainKey(mk);
  const country = ctx.country ? norm(ctx.country) : null;

  const find = (pred: (p: SizePreset) => boolean) => presets.find((p) => norm(p.sizeLabel) === l && pred(p));

  if (mk) {
    const p = find((x) => x.scope === 'merchant' && norm(x.merchantKey) === mk);
    if (p) return { preset: p, confidence: CONFIDENCE.merchant };
  }
  if (chain) {
    // chain rows may be country-specific; prefer an exact country match.
    const p =
      (country && find((x) => x.scope === 'chain' && norm(x.merchantKey) === chain && norm(x.country) === country)) ||
      find((x) => x.scope === 'chain' && norm(x.merchantKey) === chain && !x.country);
    if (p) return { preset: p, confidence: CONFIDENCE.chain };
  }
  if (country) {
    const p = find((x) => x.scope === 'country' && norm(x.country) === country);
    if (p) return { preset: p, confidence: CONFIDENCE.country };
  }
  if (l !== 'default') {
    const p = find((x) => x.scope === 'global');
    if (p) return { preset: p, confidence: CONFIDENCE.global };
  }
  return null;
}

function fromPreset(
  preset: SizePreset, confidence: number, label: string, style: string | null,
  fractionOverride?: number | null,
): ResolvedSize {
  const sliceFraction = fractionOverride ?? preset.sliceFraction;
  const dims: Dimensions = {
    shape: preset.shape,
    diameterCm: preset.diameterCm,
    lengthCm: preset.lengthCm,
    widthCm: preset.widthCm,
    sliceFraction,
  };
  return {
    sizeLabel: label,
    shape: preset.shape,
    diameterCm: preset.diameterCm,
    lengthCm: preset.lengthCm,
    widthCm: preset.widthCm,
    sliceFraction,
    areaCm2: computeAreaCm2(dims),
    sizeSource: 'preset',
    sizeConfidence: confidence,
    presetId: preset.id,
    style,
  };
}

/**
 * Resolve a parsed size to dimensions, using presets when the line does not
 * print concrete dimensions. Returns an "unresolved" record (areaCm2 null)
 * when nothing applies.
 */
export function resolveSize(
  parsed: ParsedSize,
  presets: SizePreset[],
  ctx: ResolveContext = {},
): ResolvedSize {
  // Explicit round/rect dims printed on the line.
  if (parsed.explicit && parsed.shape && parsed.shape !== 'slice') {
    const dims: Dimensions = {
      shape: parsed.shape, diameterCm: parsed.diameterCm, lengthCm: parsed.lengthCm,
      widthCm: parsed.widthCm,
    };
    return {
      sizeLabel: parsed.label,
      shape: parsed.shape,
      diameterCm: parsed.diameterCm,
      lengthCm: parsed.lengthCm,
      widthCm: parsed.widthCm,
      sliceFraction: null,
      areaCm2: computeAreaCm2(dims),
      sizeSource: 'parsed',
      sizeConfidence: CONFIDENCE.parsed,
      presetId: null,
      style: parsed.style,
    };
  }

  // Slices (single slice or half pizza): parent pie from explicit cm/inches,
  // else a 'slice' preset (slice) / a word-or-default pie preset (half).
  if (parsed.shape === 'slice') {
    if (parsed.label === 'half') {
      const pieLabel = parsed.word && parsed.word !== 'half' ? parsed.word : 'default';
      let parent: { d: number; conf: number; id: string | null; src: SizeSource } | null = null;
      if (parsed.diameterCm) {
        parent = { d: parsed.diameterCm, conf: CONFIDENCE.parsed, id: null, src: 'parsed' };
      } else {
        const hit = lookupPreset(presets, pieLabel, ctx) ?? lookupPreset(presets, 'medium', ctx);
        if (hit && hit.preset.shape === 'round' && hit.preset.diameterCm) {
          parent = { d: hit.preset.diameterCm, conf: Math.min(hit.confidence, CONFIDENCE.country), id: hit.preset.id, src: 'preset' };
        }
      }
      if (!parent) return unresolved(parsed.style, 'half');
      const dims: Dimensions = { shape: 'slice', diameterCm: parent.d, sliceFraction: 0.5 };
      return {
        sizeLabel: 'half', shape: 'slice', diameterCm: parent.d, lengthCm: null, widthCm: null,
        sliceFraction: 0.5, areaCm2: computeAreaCm2(dims), sizeSource: parent.src,
        sizeConfidence: parent.conf, presetId: parent.id, style: parsed.style,
      };
    }
    // single slice
    if (parsed.diameterCm) {
      const frac = parsed.sliceFraction ?? 0.125;
      const dims: Dimensions = { shape: 'slice', diameterCm: parsed.diameterCm, sliceFraction: frac };
      return {
        sizeLabel: 'slice', shape: 'slice', diameterCm: parsed.diameterCm, lengthCm: null, widthCm: null,
        sliceFraction: frac, areaCm2: computeAreaCm2(dims), sizeSource: 'parsed',
        sizeConfidence: CONFIDENCE.parsed, presetId: null, style: parsed.style,
      };
    }
    const hit = lookupPreset(presets, 'slice', ctx);
    if (hit && hit.preset.shape === 'slice') return fromPreset(hit.preset, hit.confidence, 'slice', parsed.style, parsed.sliceFraction);
    return unresolved(parsed.style, 'slice');
  }

  // Size word -> preset; no word -> merchant/chain/country 'default'.
  const label = parsed.word ?? 'default';
  const hit = lookupPreset(presets, label, ctx) ?? (label === 'whole' ? lookupPreset(presets, 'default', ctx) : null);
  if (hit) {
    // a bare 'default' only counts from merchant/chain/country scope (lookupPreset enforces).
    return fromPreset(hit.preset, hit.confidence, parsed.word ?? 'default', parsed.style);
  }
  return unresolved(parsed.style, parsed.word);
}

/** Convenience: parse + resolve in one go. */
export function parseAndResolve(
  name: string | null | undefined,
  presets: SizePreset[],
  ctx: ResolveContext = {},
): { parsed: ParsedSize; resolved: ResolvedSize } {
  const parsed = parseSize(name);
  return { parsed, resolved: resolveSize(parsed, presets, ctx) };
}

/**
 * Build a resolved record from a model/OCR-supplied size (LLM, vision, OCR
 * `size` field). Applies sanity bounds; confidence is capped by the caller.
 */
export function resolveFromReportedDims(
  input: {
    label?: string | null;
    shape?: string | null;
    diameterCm?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    sliceFraction?: number | null;
    style?: string | null;
  },
  confidence: number,
  source: SizeSource,
): ResolvedSize | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const d = num(input.diameterCm);
  const l = num(input.lengthCm);
  const w = num(input.widthCm);
  const f = num(input.sliceFraction);
  let shape = (input.shape ?? null) as PizzaShape | 'other' | null;
  if (shape !== 'round' && shape !== 'rect' && shape !== 'slice') {
    shape = l && w ? 'rect' : d ? 'round' : null;
  }
  if (!shape) return null;
  if (shape === 'round' && !(d && d >= MIN_ROUND_DIAMETER_CM && d <= MAX_ROUND_DIAMETER_CM)) return null;
  if (shape === 'rect' && !(l && w && l >= 15 && l <= 150 && w >= 10 && w <= 100)) return null;
  if (shape === 'slice' && !(d && d >= MIN_ROUND_DIAMETER_CM && d <= MAX_ROUND_DIAMETER_CM && f && f <= 1)) return null;
  const dims: Dimensions = { shape, diameterCm: d, lengthCm: l, widthCm: w, sliceFraction: f };
  const area = computeAreaCm2(dims);
  if (area === null) return null;
  return {
    sizeLabel: input.label ? String(input.label).toLowerCase().slice(0, 40) : (d ? `${Math.round(d)}cm` : l && w ? `${l}x${w}cm` : null),
    shape,
    diameterCm: shape === 'rect' ? null : d,
    lengthCm: shape === 'rect' ? l : null,
    widthCm: shape === 'rect' ? w : null,
    sliceFraction: shape === 'slice' ? f : null,
    areaCm2: area,
    sizeSource: source,
    sizeConfidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
    presetId: null,
    style: input.style ?? null,
  };
}
