import { Worker } from 'node:worker_threads'
import sharp from 'sharp'
import { DIMENSIONS, OVERSCAN } from './ffmpeg.js'
import { fontFiles, rasterizeSvg, type PngRef } from './cards.js'
import { safeGet } from './safeFetch.js'
import type { Ratio } from './types.js'

const PHOTO_MAX_BYTES = 30 * 1024 * 1024
const LOGO_MAX_BYTES = 5 * 1024 * 1024
/** Refuse decompression bombs: ~50 megapixels. */
export const MAX_INPUT_PIXELS = 50_000_000
/** Photos are shrunk right after download so we never hold full-size originals. */
export const PHOTO_MAX_EDGE = 3000
const SVG_MAX_BYTES = 512 * 1024
const SVG_MAX_ELEMENTS = 5000
const SVG_RENDER_TIMEOUT_MS = 10_000

const sharpOpts = { failOn: 'none' as const, limitInputPixels: MAX_INPUT_PIXELS }

/** Photos may only come from our storage origin(s). */
export function downloadPhoto(url: string, allowedOrigins: string[]): Promise<Buffer> {
  return safeGet(url, { maxBytes: PHOTO_MAX_BYTES, allowedOrigins })
}

/** Logos (sponsor / series) may live anywhere public; private addresses are blocked. */
export function downloadLogo(url: string): Promise<Buffer> {
  return safeGet(url, { maxBytes: LOGO_MAX_BYTES })
}

/** Upright, downscaled JPEG; throws on undecodable or oversized-pixel input. */
export async function normalizePhoto(input: Buffer): Promise<Buffer> {
  return sharp(input, sharpOpts)
    .rotate()
    .resize(PHOTO_MAX_EDGE, PHOTO_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
}

/**
 * Cover-crop when the photo is close to the frame's shape, otherwise fit it whole
 * over a blurred copy of itself so nobody is cut off (e.g. a portrait in 16:9).
 */
export function chooseFit(iw: number, ih: number, fw: number, fh: number): 'cover' | 'contain' {
  const r = iw / ih / (fw / fh)
  return r >= 0.7 && r <= 1.42 ? 'cover' : 'contain'
}

/** Compose a (normalised) photo into an over-sized frame for the ratio; zoompan then pans inside it. */
export async function composePhoto(input: Buffer, ratio: Ratio): Promise<Buffer> {
  const { w, h } = DIMENSIONS[ratio]
  const bw = Math.round(w * OVERSCAN)
  const bh = Math.round(h * OVERSCAN)
  const upright = await sharp(input, sharpOpts).rotate().toBuffer({ resolveWithObject: true })
  const { width: iw, height: ih } = upright.info
  if (chooseFit(iw, ih, w, h) === 'cover') {
    return sharp(upright.data, sharpOpts).resize(bw, bh, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer()
  }
  const bg = await sharp(upright.data, sharpOpts).resize(bw, bh, { fit: 'cover' }).blur(40).modulate({ brightness: 0.65 }).toBuffer()
  const fg = await sharp(upright.data, sharpOpts).resize(bw, bh, { fit: 'inside' }).toBuffer()
  return sharp(bg, sharpOpts).composite([{ input: fg, gravity: 'centre' }]).jpeg({ quality: 90 }).toBuffer()
}

export function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString('utf8').toLowerCase()
  return head.includes('<svg') || (head.includes('<?xml') && head.includes('svg'))
}

/** Reject SVGs that are huge, deeply busy, or pull in other resources. Throws with the reason. */
export function assertSvgSafe(buf: Buffer): void {
  if (buf.length > SVG_MAX_BYTES) throw new Error('svg too large')
  const text = buf.toString('utf8')
  if ((text.match(/</g)?.length ?? 0) > SVG_MAX_ELEMENTS) throw new Error('svg too complex')
  if (/<!entity|<script|<foreignobject|<image|<use[\s>]/i.test(text)) throw new Error('svg uses unsupported features')
}

const SVG_WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
const { Resvg } = require('@resvg/resvg-js')
const r = new Resvg(Buffer.from(workerData.svg), {
  fitTo: { mode: 'width', value: workerData.width },
  font: { fontFiles: workerData.fonts, loadSystemFonts: false },
})
parentPort.postMessage(Buffer.from(r.render().asPng()))
`

/** Rasterise untrusted SVG in a worker thread that is terminated if it runs too long. */
export function rasterizeUntrustedSvg(buf: Buffer, width: number, assetsDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      assertSvgSafe(buf)
    } catch (e) {
      return reject(e)
    }
    const w = new Worker(SVG_WORKER, {
      eval: true,
      workerData: { svg: buf, width, fonts: fontFiles(assetsDir) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    })
    const timer = setTimeout(() => {
      void w.terminate()
      reject(new Error('svg render timed out'))
    }, SVG_RENDER_TIMEOUT_MS)
    w.once('message', (m: Uint8Array) => {
      clearTimeout(timer)
      void w.terminate()
      resolve(Buffer.from(m))
    })
    w.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/** Turn a logo (SVG or raster) into a PNG reference for the cards. `trusted` = our own bundled art. */
export async function logoToPng(buf: Buffer, assetsDir: string, maxWidth = 640, trusted = false): Promise<PngRef> {
  const png = looksLikeSvg(buf)
    ? trusted
      ? rasterizeSvg(buf, maxWidth, assetsDir)
      : await rasterizeUntrustedSvg(buf, maxWidth, assetsDir)
    : await sharp(buf, sharpOpts).rotate().resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(png).metadata()
  return { uri: `data:image/png;base64,${png.toString('base64')}`, w: meta.width ?? maxWidth, h: meta.height ?? maxWidth / 2 }
}
