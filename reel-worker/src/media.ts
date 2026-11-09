import sharp from 'sharp'
import { DIMENSIONS, OVERSCAN } from './ffmpeg.js'
import { rasterizeSvg, type PngRef } from './cards.js'
import type { Ratio } from './types.js'

const MAX_BYTES = 30 * 1024 * 1024

/** Download over http(s) with a timeout and a size cap. */
export async function downloadBuffer(url: string, timeoutMs = 25000): Promise<Buffer> {
  if (!/^https?:\/\//i.test(url)) throw new Error('unsupported url scheme')
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_BYTES) throw new Error('file too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('file too large')
  return buf
}

/**
 * Cover-crop when the photo is close to the frame's shape, otherwise fit it whole
 * over a blurred copy of itself so nobody is cut off (e.g. a portrait in 16:9).
 */
export function chooseFit(iw: number, ih: number, fw: number, fh: number): 'cover' | 'contain' {
  const r = iw / ih / (fw / fh)
  return r >= 0.7 && r <= 1.42 ? 'cover' : 'contain'
}

/** Compose a photo into an over-sized frame for the ratio; zoompan then pans inside it. */
export async function composePhoto(input: Buffer, ratio: Ratio): Promise<Buffer> {
  const { w, h } = DIMENSIONS[ratio]
  const bw = Math.round(w * OVERSCAN)
  const bh = Math.round(h * OVERSCAN)
  // Apply EXIF rotation once, then work from the upright pixels.
  const upright = await sharp(input, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true })
  const { width: iw, height: ih } = upright.info
  if (chooseFit(iw, ih, w, h) === 'cover') {
    return sharp(upright.data).resize(bw, bh, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer()
  }
  const bg = await sharp(upright.data).resize(bw, bh, { fit: 'cover' }).blur(40).modulate({ brightness: 0.65 }).toBuffer()
  const fg = await sharp(upright.data).resize(bw, bh, { fit: 'inside' }).toBuffer()
  return sharp(bg).composite([{ input: fg, gravity: 'centre' }]).jpeg({ quality: 90 }).toBuffer()
}

/** Turn any logo (SVG or raster) into a PNG reference for the cards. */
export async function logoToPng(buf: Buffer, assetsDir: string, maxWidth = 640): Promise<PngRef> {
  const head = buf.subarray(0, 512).toString('utf8').toLowerCase()
  const isSvg = head.includes('<svg') || (head.includes('<?xml') && head.includes('svg'))
  const png = isSvg
    ? rasterizeSvg(buf, maxWidth, assetsDir)
    : await sharp(buf, { failOn: 'none' }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(png).metadata()
  return { uri: `data:image/png;base64,${png.toString('base64')}`, w: meta.width ?? maxWidth, h: meta.height ?? maxWidth / 2 }
}
