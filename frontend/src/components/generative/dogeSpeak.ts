// Doge-speak layer for the Doge Day flyers.
// Phrase logic (DOGE_COLORS, TOPIC_ADJECTIVES, generateDogeTexts, the 5-phrase scatter, the
// outlined Comic Sans text) is ported from Snax's "Much Wow" meme generator
// (https://muchwow.vercel.app), with Math.random replaced by a seeded PRNG so a flyer is
// stable across repaints and only changes when the seed does ("shuffle wow").

export const DOGE_FONT = 'Comic Sans MS, Comic Neue, cursive';
export const DOGE_OUTLINE = '#302D25';
/** Cream of the Doge Day template; used for the legibility check. */
export const DOGE_BG = '#F3EBD8';

/** Much Wow's palette. */
export const DOGE_COLORS = ['#ff00ff', '#ff0000', '#00cc00', '#0066ff', '#ff8800', '#ffff00', '#00cccc', '#ff69b4'];

export const DOGE_PREFIXES = ['such', 'much', 'very', 'so', 'many'];
export const DOGE_STANDALONE = ['wow', 'amaze', 'excite', 'plz', 'yes'];
export const TOPIC_ADJECTIVES: Record<string, string[]> = {
  _default: ['amazing', 'cool', 'nice', 'great', 'good', 'best', 'incredible', 'epic', 'awesome', 'fantastic'],
  pizza: ['cheesy', 'crusty', 'saucy', 'hot', 'tasty', 'delicious', 'crispy', 'fresh'],
  crypto: ['hodl', 'moon', 'bullish', 'decentralized', 'hash', 'mint', 'stake', 'whale'],
  dogs: ['bark', 'fetch', 'fluffy', 'loyal', 'bork', 'snoot', 'tail', 'belly rubs'],
};

export type Rng = () => number;

/** mulberry32 seeded from a string hash (FNV-1a). Deterministic, no deps. */
export function seededRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Much Wow's generateDogeTexts(topic): 5 phrases, always starting with "wow". */
export function generateDogeTexts(topic: string, rng: Rng): string[] {
  const t = topic.toLowerCase().trim();
  const adjectives = TOPIC_ADJECTIVES[t] || TOPIC_ADJECTIVES._default;
  const prefixes = shuffle(DOGE_PREFIXES, rng);
  const adj = shuffle(adjectives, rng);
  const phrases = ['wow', `${prefixes[0]} ${t}`, `${prefixes[1]} ${adj[0]}`, `${prefixes[2]} ${adj[1]}`];
  phrases.push(rng() > 0.5 ? `${prefixes[3]} ${t}` : pickRandom(DOGE_STANDALONE, rng));
  return phrases;
}

/** Lowercase and shorten a city for doge-speak ("San Francisco Bay Area" -> "san francisco"). */
export function shortenCity(city: string, maxLen = 14): string {
  const clean = city
    .replace(/[,;|].*$/, '') // "Austin, TX" -> "Austin"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (clean.length <= maxLen) return clean;
  const words = clean.split(' ');
  let out = words[0];
  for (let i = 1; i < words.length; i++) {
    if ((out + ' ' + words[i]).length > maxLen) break;
    out += ' ' + words[i];
  }
  return out.length > maxLen ? out.slice(0, maxLen).trim() : out;
}

// ---- contrast ----
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Colors from the Much Wow palette that stay readable on the cream flyer: the dark outline must
 * clear 4.5:1 against the cream (so the stroked glyph edge is crisp) and the fill must clear 2.5:1
 * against the outline. Dark outline + bright fill is what lets yellow/cyan/orange pass on cream.
 */
export function readableColors(bg = DOGE_BG, outline = DOGE_OUTLINE): string[] {
  if (contrast(outline, bg) < 4.5) return [];
  return DOGE_COLORS.filter((c) => contrast(c, outline) >= 2.5);
}

export interface DogePhrase {
  text: string;
  color: string;
}

/**
 * Event doge-speak: "wow", "such pizza", "very {city}", "much party", "so doge day" with
 * Much Wow's seeded-shuffled prefixes and colors. Same seed + city => same phrases.
 */
export function buildDogePhrases(seed: string, city: string): DogePhrase[] {
  const rng = seededRng(`${seed}|${city}`);
  const prefixes = shuffle(DOGE_PREFIXES, rng);
  const adj = shuffle(TOPIC_ADJECTIVES.pizza, rng);
  const place = shortenCity(city);
  const hasCity = place.length > 0 && place !== 'your city';
  const texts = [
    'wow',
    `${prefixes[0]} pizza`,
    `${prefixes[2]} party`,
    'so doge day',
    // Last slot is the widest on both templates, so the (longest) city phrase goes there.
    hasCity ? `${prefixes[1]} ${place}` : `${prefixes[1]} ${adj[0]}`,
  ];
  const palette = readableColors();
  const colors = shuffle(palette.length >= 5 ? palette : [...palette, ...DOGE_COLORS], rng);
  return texts.map((text, i) => ({ text, color: colors[i % colors.length] }));
}

// ---- drawing ----
export interface DogeSlot {
  x: number;
  y: number;
  fontSize: number;
  /** Text shrinks (never wraps) to fit this width so it can't run into the Doge's face or fields. */
  maxWidth: number;
}

let fontPromise: Promise<void> | null = null;
/** Load Comic Neue (fallback for devices without Comic Sans) and wait for it before painting. */
export function ensureDogeFont(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  if (!fontPromise) {
    if (!document.querySelector('link[data-comic-neue]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@700&display=swap';
      link.setAttribute('data-comic-neue', '');
      document.head.appendChild(link);
    }
    const load = document.fonts.load('bold 36px "Comic Neue"').then(() => undefined, () => undefined);
    const timeout = new Promise<void>((r) => setTimeout(r, 3000));
    fontPromise = Promise.race([load, timeout]);
  }
  return fontPromise;
}

/** Draw outlined doge-speak (Much Wow's render(): stroke, then fill). `s` = scale factor. */
export function drawDogeSpeak(
  ctx: CanvasRenderingContext2D,
  phrases: DogePhrase[],
  slots: DogeSlot[],
  s = 1,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  phrases.slice(0, slots.length).forEach((p, i) => {
    const slot = slots[i];
    let size = slot.fontSize * s;
    ctx.font = `bold ${size}px ${DOGE_FONT}`;
    const w = ctx.measureText(p.text).width;
    const max = slot.maxWidth * s;
    if (w > max) {
      size = Math.max(12 * s, size * (max / w));
      ctx.font = `bold ${size}px ${DOGE_FONT}`;
    }
    ctx.strokeStyle = DOGE_OUTLINE;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.strokeText(p.text, slot.x * s, slot.y * s);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, slot.x * s, slot.y * s);
  });
  ctx.restore();
}
