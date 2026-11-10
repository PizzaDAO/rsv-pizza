/**
 * The renderer: render(spec) -> mp4 files on disk. Kept behind this one function
 * so a different engine (Remotion, a hosted API) can be swapped in later.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildClipArgs, buildMuxArgs, buildPosterArgs, buildXfadeArgs, DEFAULT_CALL_TIMEOUT_MS, runFfmpeg, xfadeTotal,
  type XfadeClip,
} from './ffmpeg.js'
import { endCardSvg, rasterizeSvg, titleCardSvg, type PngRef } from './cards.js'
import { composePhoto, downloadLogo, downloadPhoto, logoToPng, normalizePhoto } from './media.js'
import type { Ratio, ReelSpec } from './types.js'

export interface RenderDeps {
  workDir: string
  assetsDir: string
  /** Origins photo URLs must come from (our storage). Required unless fetchBuffer is injected. */
  photoOrigins?: string[]
  /** Epoch ms after which the render must stop. */
  deadline?: number
  /** Override downloads (tests). Defaults: photos via the origin allow-list, logos via the SSRF guard. */
  fetchBuffer?: (url: string) => Promise<Buffer>
  /** Download a music track into `dest`. Omit to skip music. */
  fetchMusic?: (key: string, dest: string) => Promise<void>
  onProgress?: (pct: number) => void
  log?: (msg: string) => void
}

export interface RenderResult {
  /** variant name -> local mp4, e.g. "9x16_nomusic" */
  videos: Record<string, string>
  poster: string
  /** Photos that were skipped because they failed to download or decode. */
  skipped: number
  seconds: number
}

const MIN_USABLE_PHOTOS = 3

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export async function renderReel(spec: ReelSpec, deps: RenderDeps): Promise<RenderResult> {
  const log = deps.log ?? (() => {})
  const fetchPhoto = deps.fetchBuffer ?? ((u: string) => downloadPhoto(u, deps.photoOrigins ?? []))
  const fetchLogo = deps.fetchBuffer ?? ((u: string) => downloadLogo(u))
  const deadline = deps.deadline ?? Date.now() + 15 * 60 * 1000
  const remaining = () => deadline - Date.now()
  const ff = (args: string[]) => {
    if (remaining() <= 0) throw new Error('job deadline exceeded')
    return runFfmpeg(args, { timeoutMs: Math.min(DEFAULT_CALL_TIMEOUT_MS, remaining()) })
  }
  const progress = deps.onProgress ?? (() => {})
  const dir = path.join(deps.workDir, spec.reelId)
  await mkdir(dir, { recursive: true })

  // 1. Download photos; a bad one is skipped, not fatal.
  const raw = await mapLimit(spec.items, 4, async (it) => {
    try {
      // Shrink immediately so full-size originals are never kept in memory.
      return await normalizePhoto(await fetchPhoto(it.url))
    } catch (e) {
      log(`skip photo ${it.id}: ${(e as Error).message}`)
      return null
    }
  })
  progress(10)

  // 2. Logos (all optional).
  const pizzaDaoSvg = await readFile(path.join(deps.assetsDir, 'pizzadao-logo.svg'))
  const logo = await logoToPng(pizzaDaoSvg, deps.assetsDir, 900, true)
  let gppLogo: PngRef | null = null
  if (spec.gppLogoUrl) {
    try {
      gppLogo = await logoToPng(await fetchLogo(spec.gppLogoUrl), deps.assetsDir)
    } catch (e) {
      log(`skip GPP logo: ${(e as Error).message}`)
    }
  }
  const sponsors: PngRef[] = []
  for (const s of spec.sponsors) {
    try {
      sponsors.push(await logoToPng(await fetchLogo(s.logoUrl), deps.assetsDir))
    } catch (e) {
      log(`skip sponsor logo ${s.id}: ${(e as Error).message}`)
    }
  }
  progress(15)

  const tl = spec.timeline
  let music: string | null = null
  if (spec.music && deps.fetchMusic) {
    try {
      music = path.join(dir, 'music')
      await deps.fetchMusic(spec.music.key, music)
    } catch (e) {
      log(`music unavailable, rendering without: ${(e as Error).message}`)
      music = null
    }
  }

  const videos: Record<string, string> = {}
  let poster = ''
  let seconds = 0
  let skipped = 0
  const ratioCount = spec.ratios.length

  for (let ri = 0; ri < ratioCount; ri++) {
    const ratio = spec.ratios[ri] as Ratio
    const base = 15 + (ri * 80) / ratioCount
    const span = 80 / ratioCount
    const clips: XfadeClip[] = []

    const addClip = async (name: string, image: Buffer, secs: number, index: number, subtle = false) => {
      const imgPath = path.join(dir, `${ratio}_${name}.${image.subarray(0, 2).toString('hex') === '8950' ? 'png' : 'jpg'}`)
      await writeFile(imgPath, image)
      const out = path.join(dir, `${ratio}_${name}.mp4`)
      await ff(buildClipArgs({ image: imgPath, out, ratio, seconds: secs, index, subtle }))
      clips.push({ file: out, seconds: secs })
    }

    await addClip('title', rasterizeSvg(titleCardSvg({ ratio, spec, logo }), ratioWidth(ratio), deps.assetsDir), tl.titleSeconds, 0, true)
    progress(base + span * 0.1)

    let used = 0
    skipped = 0
    for (let i = 0; i < raw.length; i++) {
      const buf = raw[i]
      if (!buf) {
        skipped++
        continue
      }
      try {
        await addClip(`p${i}`, await composePhoto(buf, ratio), tl.itemSeconds, used + 1)
        used++
      } catch (e) {
        skipped++
        log(`skip undecodable photo ${spec.items[i].id}: ${(e as Error).message}`)
      }
      progress(base + span * (0.1 + (0.6 * (i + 1)) / raw.length))
    }
    if (used < MIN_USABLE_PHOTOS) throw new Error(`only ${used} usable photos (need ${MIN_USABLE_PHOTOS})`)

    await addClip('end', rasterizeSvg(endCardSvg({ ratio, spec, logo, gppLogo, sponsors }), ratioWidth(ratio), deps.assetsDir), tl.endSeconds, 3, true)

    const master = path.join(dir, `${ratio}_nomusic.mp4`)
    await ff(buildXfadeArgs(clips, tl.transitionSeconds, master))
    videos[`${ratio}_nomusic`] = master
    seconds = xfadeTotal(clips.map((c) => c.seconds), tl.transitionSeconds)
    progress(base + span * 0.85)

    if (music) {
      const withMusic = path.join(dir, `${ratio}.mp4`)
      await ff(buildMuxArgs({ video: master, music, out: withMusic, seconds }))
      videos[ratio] = withMusic
    }
    if (!poster) {
      poster = path.join(dir, 'poster.jpg')
      await ff(buildPosterArgs(master, poster, Math.min(tl.titleSeconds + 0.5, seconds / 2)))
    }
    progress(base + span)
  }
  return { videos, poster, skipped, seconds }
}

function ratioWidth(r: Ratio): number {
  return r === '9x16' ? 1080 : 1920
}
