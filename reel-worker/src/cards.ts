/**
 * Global Pizza Party branded title and end cards, drawn as SVG and rasterised
 * with resvg. Branding comes from the repo's GPP art: Hub 191 Display type
 * (frontend/public/fonts), the PizzaDAO logo (frontend/public/pizzadao-logo.svg),
 * and the sky / red / yellow palette from the GPP flyer. The SVG builders are
 * pure so layout can be unit-tested.
 */
import { Resvg } from '@resvg/resvg-js'
import path from 'node:path'
import type { Brand, Ratio, ReelSpec } from './types.js'
import { DIMENSIONS } from './ffmpeg.js'

export const FONT_FAMILY = 'Hub 191 Display'
/** Hub 191 Display is wide; this is its rough average advance in em, used to fit text. */
const CHAR_EM = 0.66

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/** Greedy word wrap to at most `maxLines` lines of `maxChars`; the last line is ellipsised if it overflows. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars || !cur) {
      cur = next
    } else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    const last = kept[maxLines - 1]
    kept[maxLines - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last).replace(/[\s.,;:-]+$/, '') + '…'
    return kept
  }
  return lines.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l))
}

export interface GridLayout {
  cols: number
  rows: number
  cellW: number
  cellH: number
}

/** Fit `count` logo tiles into an area, preferring wide cells. */
export function gridLayout(count: number, areaW: number, areaH: number, gap: number): GridLayout {
  if (count <= 0) return { cols: 0, rows: 0, cellW: 0, cellH: 0 }
  let best: GridLayout & { score: number } | null = null
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = (areaW - gap * (cols - 1)) / cols
    const cellH = (areaH - gap * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue
    // Prefer big cells whose aspect is near 2:1 (typical wordmark logo).
    const score = Math.min(cellW, cellH * 2) / Math.max(cellW, cellH * 2) * Math.min(cellW, cellH * 2)
    if (!best || score > best.score) best = { cols, rows, cellW: Math.floor(cellW), cellH: Math.floor(cellH), score }
  }
  if (!best) return { cols: 1, rows: count, cellW: Math.floor(areaW), cellH: Math.floor(areaH / count) }
  return { cols: best.cols, rows: best.rows, cellW: best.cellW, cellH: best.cellH }
}

function fitFont(chars: number, maxWidth: number, maxSize: number): number {
  return Math.max(12, Math.min(maxSize, Math.floor(maxWidth / (Math.max(1, chars) * CHAR_EM))))
}

/** Deterministic confetti so a re-render looks identical. */
function confetti(w: number, h: number, brand: Brand, seed: number, count = 26): string {
  let s = seed
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const colors = [brand.red, brand.yellow, '#ffffff']
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = (0.006 + rnd() * 0.01) * Math.min(w, h)
    const rot = Math.floor(rnd() * 180)
    out.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(r * 2.2).toFixed(1)}" height="${r.toFixed(1)}" rx="${(r / 3).toFixed(1)}" fill="${colors[i % 3]}" opacity="0.9" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`,
    )
  }
  return out.join('')
}

function text(
  str: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opts: { stroke?: string; anchor?: string } = {},
): string {
  const stroke = opts.stroke
    ? ` stroke="${opts.stroke}" stroke-width="${(size * 0.07).toFixed(1)}" stroke-linejoin="round" paint-order="stroke"`
    : ''
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" fill="${fill}" text-anchor="${opts.anchor ?? 'middle'}"${stroke}>${escapeXml(str)}</text>`
}

export interface PngRef {
  /** PNG data URI */
  uri: string
  w: number
  h: number
}

function image(ref: PngRef, cx: number, cy: number, maxW: number, maxH: number): string {
  const scale = Math.min(maxW / ref.w, maxH / ref.h)
  const w = Math.round(ref.w * scale)
  const h = Math.round(ref.h * scale)
  return `<image x="${Math.round(cx - w / 2)}" y="${Math.round(cy - h / 2)}" width="${w}" height="${h}" href="${ref.uri}"/>`
}

export interface TitleCardInput {
  ratio: Ratio
  spec: Pick<ReelSpec, 'title' | 'city' | 'dateLabel' | 'brand'>
  /** White PizzaDAO logo, rasterised. */
  logo: PngRef | null
}

export function titleCardSvg(i: TitleCardInput): string {
  const { w, h } = DIMENSIONS[i.ratio]
  const portrait = i.ratio === '9x16'
  const b = i.spec.brand
  const pad = w * 0.07
  const parts: string[] = []
  parts.push(
    `<defs><radialGradient id="g" cx="50%" cy="${portrait ? 40 : 45}%" r="75%"><stop offset="0" stop-color="#bfeaf8"/><stop offset="1" stop-color="${b.sky}"/></radialGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
    confetti(w, h, b, 7),
  )
  if (i.logo) parts.push(image(i.logo, w / 2, h * (portrait ? 0.09 : 0.14), w * (portrait ? 0.6 : 0.3), h * 0.1))

  // Wordmark: GLOBAL / PIZZA / PARTY stacked on portrait, single line on landscape.
  const wm = portrait ? ['GLOBAL', 'PIZZA', 'PARTY'] : ['GLOBAL PIZZA PARTY']
  const wmSize = fitFont(Math.max(...wm.map((l) => l.length)), w - pad * 2, portrait ? h * 0.115 : h * 0.17)
  let y = portrait ? h * 0.26 : h * 0.36
  for (const line of wm) {
    parts.push(text(line, w / 2, y, wmSize, '#ffffff', { stroke: b.ink }))
    y += wmSize * 1.02
  }

  // Event name (host-editable), city, date.
  const maxChars = portrait ? 16 : 30
  const nameLines = wrapText(i.spec.title, maxChars, 2)
  const nameSize = fitFont(Math.max(...nameLines.map((l) => l.length), 1), w - pad * 2, portrait ? h * 0.06 : h * 0.1)
  y += portrait ? h * 0.05 : h * 0.07
  for (const line of nameLines) {
    parts.push(text(line.toUpperCase(), w / 2, y, nameSize, b.red, { stroke: '#ffffff' }))
    y += nameSize * 1.1
  }
  const sub = [i.spec.city, i.spec.dateLabel].filter(Boolean).join(' - ')
  if (sub) {
    const subSize = fitFont(sub.length, w - pad * 2, portrait ? h * 0.035 : h * 0.055)
    y += subSize * 0.6
    parts.push(text(sub.toUpperCase(), w / 2, y, subSize, b.ink))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`
}

export interface EndCardInput {
  ratio: Ratio
  spec: Pick<ReelSpec, 'guestCount' | 'siteDomain' | 'brand'>
  logo: PngRef | null
  /** Optional Global Pizza Party series logo (rasterised). */
  gppLogo: PngRef | null
  sponsors: PngRef[]
}

export function endCardSvg(i: EndCardInput): string {
  const { w, h } = DIMENSIONS[i.ratio]
  const portrait = i.ratio === '9x16'
  const b = i.spec.brand
  const pad = w * 0.07
  const parts: string[] = []
  parts.push(`<rect width="${w}" height="${h}" fill="${b.red}"/>`, confetti(w, h, { ...b, red: b.yellow }, 11, 22))

  let y = h * (portrait ? 0.07 : 0.12)
  if (i.logo) parts.push(image(i.logo, w / 2, y, w * (portrait ? 0.6 : 0.3), h * 0.09))
  y += h * (portrait ? 0.1 : 0.14)

  if (i.gppLogo) {
    const lh = h * (portrait ? 0.16 : 0.26)
    parts.push(image(i.gppLogo, w / 2, y + lh / 2, w * 0.6, lh))
    y += lh + h * 0.03
  } else {
    const wm = portrait ? ['GLOBAL PIZZA', 'PARTY'] : ['GLOBAL PIZZA PARTY']
    const size = fitFont(Math.max(...wm.map((l) => l.length)), w - pad * 2, portrait ? h * 0.08 : h * 0.12)
    for (const line of wm) {
      y += size
      parts.push(text(line, w / 2, y, size, '#ffffff', { stroke: b.ink }))
      y += size * 0.05
    }
    y += h * 0.02
  }

  const msg = i.spec.guestCount ? `${i.spec.guestCount} PIZZA LOVERS SHOWED UP` : 'THANKS FOR COMING'
  const msgLines = wrapText(msg, portrait ? 18 : 40, 2)
  const msgSize = fitFont(Math.max(...msgLines.map((l) => l.length)), w - pad * 2, portrait ? h * 0.04 : h * 0.06)
  for (const line of msgLines) {
    y += msgSize * 1.15
    parts.push(text(line, w / 2, y, msgSize, b.yellow, { stroke: b.ink }))
  }
  y += h * 0.03

  // Sponsor tiles.
  const footerH = h * 0.09
  if (i.sponsors.length) {
    const areaTop = y
    const areaH = h - footerH - areaTop - h * 0.02
    const areaW = w - pad * 2
    const gap = Math.round(w * 0.02)
    const g = gridLayout(i.sponsors.length, areaW, areaH, gap)
    const gridH = g.rows * g.cellH + (g.rows - 1) * gap
    const y0 = areaTop + Math.max(0, (areaH - gridH) / 2)
    i.sponsors.forEach((s, k) => {
      const row = Math.floor(k / g.cols)
      // Center a short last row.
      const inRow = row === g.rows - 1 ? i.sponsors.length - row * g.cols : g.cols
      const rowW = inRow * g.cellW + (inRow - 1) * gap
      const cx = (w - rowW) / 2 + (k % g.cols) * (g.cellW + gap) + g.cellW / 2
      const cy = y0 + row * (g.cellH + gap) + g.cellH / 2
      parts.push(
        `<rect x="${Math.round(cx - g.cellW / 2)}" y="${Math.round(cy - g.cellH / 2)}" width="${g.cellW}" height="${g.cellH}" rx="${Math.round(g.cellH * 0.12)}" fill="#ffffff"/>`,
        image(s, cx, cy, g.cellW * 0.82, g.cellH * 0.7),
      )
    })
  }

  const urlSize = fitFont(i.spec.siteDomain.length, w - pad * 2, h * 0.04)
  parts.push(text(i.spec.siteDomain, w / 2, h - footerH / 2 + urlSize / 3, urlSize, '#ffffff', { stroke: b.ink }))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`
}

export function fontFiles(assetsDir: string): string[] {
  return [path.join(assetsDir, 'Hub-191-Display.otf'), path.join(assetsDir, 'Hub-191-Regular.otf')]
}

/** Rasterise an SVG string to PNG at the given pixel width. */
export function rasterizeSvg(svg: string | Buffer, width: number, assetsDir: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: fontFiles(assetsDir), loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  })
  return r.render().asPng()
}
