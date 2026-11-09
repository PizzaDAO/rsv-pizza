/**
 * ffmpeg command building (pure, unit-tested) plus a thin runner.
 * Every function returns an argv array; nothing goes through a shell.
 */
import { spawn } from 'node:child_process'
import type { Ratio } from './types.js'

export const FPS = 30
export const DIMENSIONS: Record<Ratio, { w: number; h: number }> = {
  '9x16': { w: 1080, h: 1920 },
  '16x9': { w: 1920, h: 1080 },
}
/** Source frames are composed this much larger than the output so the pan stays sharp. */
export const OVERSCAN = 1.5

export const TRANSITIONS = ['fade', 'slideleft', 'fade', 'circleopen', 'slideright', 'fadeblack'] as const

export interface Motion {
  z: string
  x: string
  y: string
}

const PAN: Array<{ zoom: 'in' | 'out'; x: [number, number]; y: [number, number] }> = [
  { zoom: 'in', x: [0.5, 0.5], y: [0.5, 0.5] },
  { zoom: 'in', x: [0.1, 0.9], y: [0.5, 0.5] },
  { zoom: 'in', x: [0.5, 0.5], y: [0.1, 0.9] },
  { zoom: 'out', x: [0.5, 0.5], y: [0.5, 0.5] },
  { zoom: 'in', x: [0.9, 0.1], y: [0.5, 0.5] },
  { zoom: 'in', x: [0.5, 0.5], y: [0.9, 0.1] },
]
const ZOOM_RANGE = 0.12

/** Ken Burns zoompan expressions for the nth item, over `frames` frames. */
export function kenBurnsMotion(index: number, frames: number, subtle = false): Motion {
  const p = PAN[((index % PAN.length) + PAN.length) % PAN.length]
  const n = Math.max(1, frames - 1)
  const range = subtle ? ZOOM_RANGE / 3 : ZOOM_RANGE
  const t = `on/${n}`
  const z = p.zoom === 'in' ? `1+${range}*${t}` : `${1 + range}-${range}*${t}`
  const lerp = (a: number, b: number) => (a === b ? `${a}` : `${a}+(${round(b - a)})*${t}`)
  return {
    z,
    x: `(iw-iw/zoom)*(${lerp(p.x[0], p.x[1])})`,
    y: `(ih-ih/zoom)*(${lerp(p.y[0], p.y[1])})`,
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

export const framesFor = (seconds: number): number => Math.max(1, Math.round(seconds * FPS))

export interface ClipArgsInput {
  image: string
  out: string
  ratio: Ratio
  seconds: number
  index: number
  subtle?: boolean
}

/** One still image -> one H.264 clip with a Ken Burns move. */
export function buildClipArgs(i: ClipArgsInput): string[] {
  const { w, h } = DIMENSIONS[i.ratio]
  const frames = framesFor(i.seconds)
  const m = kenBurnsMotion(i.index, frames, i.subtle)
  const vf = `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${w}x${h}:fps=${FPS},format=yuv420p`
  return [
    '-y', '-i', i.image,
    '-vf', vf,
    '-frames:v', String(frames),
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-an',
    i.out,
  ]
}

export interface XfadeClip {
  file: string
  seconds: number
}

/** xfade offsets: transition k starts when the accumulated video (minus overlaps) reaches clip k's end. */
export function xfadeOffsets(durations: number[], transition: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let k = 0; k < durations.length - 1; k++) {
    sum += durations[k]
    out.push(round(sum - (k + 1) * transition))
  }
  return out
}

/** Final length of clips joined by xfade. */
export function xfadeTotal(durations: number[], transition: number): number {
  const sum = durations.reduce((a, b) => a + b, 0)
  return round(sum - Math.max(0, durations.length - 1) * transition)
}

/** Join clips with cross transitions into one video-only master. */
export function buildXfadeArgs(clips: XfadeClip[], transition: number, out: string): string[] {
  if (clips.length === 0) throw new Error('no clips to join')
  const inputs = clips.flatMap((c) => ['-i', c.file])
  const head = ['-y', ...inputs]
  const tail = [
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    out,
  ]
  if (clips.length === 1) return [...head, ...tail]
  const offsets = xfadeOffsets(clips.map((c) => c.seconds), transition)
  const parts: string[] = []
  let prev = '[0:v]'
  offsets.forEach((off, k) => {
    const label = k === offsets.length - 1 ? '[vout]' : `[x${k + 1}]`
    const name = TRANSITIONS[k % TRANSITIONS.length]
    parts.push(`${prev}[${k + 1}:v]xfade=transition=${name}:duration=${transition}:offset=${off}${label}`)
    prev = label
  })
  return [...head, '-filter_complex', parts.join(';'), '-map', '[vout]', ...tail]
}

export interface MuxInput {
  video: string
  music: string
  out: string
  seconds: number
}

/** Add a music bed: loudness-normalised, looped if short, faded in and out. Video stream is copied. */
export function buildMuxArgs(i: MuxInput): string[] {
  const d = round(i.seconds)
  const fadeOutStart = Math.max(0, round(d - 2))
  const af = `loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:${d},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2`
  return [
    '-y',
    '-i', i.video,
    '-stream_loop', '-1', '-i', i.music,
    '-filter_complex', `[1:a]${af}[a]`,
    '-map', '0:v:0', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(d),
    '-movflags', '+faststart',
    i.out,
  ]
}

export function buildPosterArgs(video: string, out: string, atSeconds: number): string[] {
  return ['-y', '-ss', String(atSeconds), '-i', video, '-frames:v', '1', '-q:v', '3', out]
}

export function runFfmpeg(args: string[], bin = 'ffmpeg'): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => {
      err = (err + d.toString()).slice(-4000)
    })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))))
  })
}

export interface ProbeResult {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export function runFfprobe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.trim()}`))
      try {
        const j = JSON.parse(out) as { streams: Array<{ codec_type: string; width?: number; height?: number }>; format: { duration?: string } }
        const v = j.streams.find((s) => s.codec_type === 'video')
        resolve({
          duration: Number(j.format.duration ?? 0),
          width: v?.width ?? 0,
          height: v?.height ?? 0,
          hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
        })
      } catch (e) {
        reject(e)
      }
    })
  })
}
