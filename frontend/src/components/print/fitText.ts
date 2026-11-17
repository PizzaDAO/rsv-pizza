export const PRINT_FONT_STACK =
  '"Inter", system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans CJK JP", "Microsoft YaHei", sans-serif';

export type MeasureFn = (text: string, sizePt: number, weight?: number) => number;

let ctx: CanvasRenderingContext2D | null | undefined;

/** Width in pt of `text` at `sizePt`. Canvas measure when available, else a CJK-aware estimate. */
export const defaultMeasure: MeasureFn = (text, sizePt, weight = 700) => {
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' && !navigator.userAgent.includes('jsdom') ?document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (ctx) {
    ctx.font = `${weight} ${sizePt}px ${PRINT_FONT_STACK}`;
    const w = ctx.measureText(text).width;
    if (w > 0) return w;
  }
  let units = 0;
  for (const ch of text) units += /[ᄀ-ᇿ⺀-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.58;
  return units * sizePt;
};

export interface FitOptions {
  /** Available width in pt. */
  maxWidth: number;
  maxSize?: number;
  minSize?: number;
  /** Prefer wrapping to two lines before shrinking below this size. */
  wrapBelow?: number;
  measure?: MeasureFn;
  weight?: number;
}

export interface FitResult {
  size: number;
  lines: string[];
}

/** Split into two lines near the middle: at a space if there is one, else mid-string. */
export function splitTwoLines(text: string): [string, string] {
  const chars = Array.from(text);
  const mid = Math.floor(chars.length / 2);
  let best = -1;
  for (let d = 0; d <= mid; d++) {
    if (chars[mid - d] === ' ') { best = mid - d; break; }
    if (chars[mid + d] === ' ') { best = mid + d; break; }
  }
  if (best < 0) return [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
  return [chars.slice(0, best).join('').trim(), chars.slice(best + 1).join('').trim()];
}

/**
 * Largest font size (pt) at which `text` fits `maxWidth`. One line down to `wrapBelow`, then two
 * lines down to `minSize`; at `minSize` it returns whatever is left (caller may clip).
 */
export function fitText(text: string, opts: FitOptions): FitResult {
  const { maxWidth, maxSize = 40, minSize = 14, wrapBelow = 20, measure = defaultMeasure, weight = 700 } = opts;
  const t = text.trim();
  for (let s = maxSize; s >= Math.max(minSize, wrapBelow); s -= 1) {
    if (measure(t, s, weight) <= maxWidth) return { size: s, lines: [t] };
  }
  const two = splitTwoLines(t);
  const lines = two[1] ? two : [t];
  for (let s = Math.min(maxSize, Math.max(minSize, wrapBelow)); s >= minSize; s -= 1) {
    if (lines.every((l) => measure(l, s, weight) <= maxWidth)) return { size: s, lines };
  }
  return { size: minSize, lines };
}
