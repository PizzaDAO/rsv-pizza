/**
 * Golden test: render a fixture spec (5 photos, 1 logo, 1 track) for both ratios and
 * ffprobe the outputs. Needs ffmpeg/ffprobe on PATH; skipped otherwise.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { renderReel } from './render.js'
import { runFfprobe } from './ffmpeg.js'
import type { ReelSpec } from './types.js'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets')

async function fakePhoto(i: number, w: number, h: number): Promise<Buffer> {
  const hue = (i * 70) % 360
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 40 + hue % 200, g: 90 + (i * 30) % 120, b: 160 } } })
    .jpeg()
    .toBuffer()
}

const LOGO_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#0a7"/></svg>')

const spec: ReelSpec = {
  version: 1,
  reelId: '66666666-7777-8888-9999-000000000000',
  partyId: '11111111-2222-3333-4444-555555555555',
  title: 'Golden Test Party',
  city: 'Austin',
  dateLabel: 'May 22, 2026',
  guestCount: 42,
  siteDomain: 'example.com',
  ratios: ['9x16', '16x9'],
  items: [
    { id: 'a', url: 'https://example.com/a.jpg' },
    { id: 'b', url: 'https://example.com/b.jpg' }, // portrait, forces the blur-fill path in 16:9
    { id: 'c', url: 'https://example.com/c.jpg' },
    { id: 'd', url: 'https://example.com/d.jpg' },
    { id: 'e', url: 'https://example.com/e.jpg' },
    { id: 'bad', url: 'https://example.com/missing.jpg' }, // fails to load: skipped, not fatal
  ],
  sponsors: [{ id: 's1', name: 'Acme', logoUrl: 'https://example.com/logo.svg' }],
  gppLogoUrl: null,
  music: { key: 'songs/test/tone.mp3', title: 'tone' },
  timeline: { titleSeconds: 1.5, endSeconds: 2, itemSeconds: 1.5, transitionSeconds: 0.5, totalSeconds: 0 },
  brand: { red: '#ff393a', sky: '#7dd3f0', yellow: '#ffd800', ink: '#0b0b10' },
  outputPrefix: 'reels/11111111-2222-3333-4444-555555555555/66666666-7777-8888-9999-000000000000',
}

describe.skipIf(!hasFfmpeg)('renderReel golden', () => {
  let dir = ''
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('renders both ratios with and without music', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'reel-golden-'))
    const photos: Record<string, Buffer> = {
      a: await fakePhoto(1, 1600, 1200),
      b: await fakePhoto(2, 900, 1600),
      c: await fakePhoto(3, 1200, 1200),
      d: await fakePhoto(4, 2000, 1000),
      e: await fakePhoto(5, 1000, 1500),
    }
    const result = await renderReel(spec, {
      workDir: dir,
      assetsDir,
      fetchBuffer: async (url) => {
        if (url.endsWith('logo.svg')) return LOGO_SVG
        const id = url.split('/').pop()!.replace('.jpg', '')
        if (!photos[id]) throw new Error('HTTP 404')
        return photos[id]
      },
      fetchMusic: async (_key, dest) => {
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', dest + '.wav'])
        execFileSync('cp', [dest + '.wav', dest])
      },
    })
    expect(result.skipped).toBe(1)
    // 5 photos: 1.5 + 5*1.5 + 2 - 6*0.5 = 8s
    expect(result.seconds).toBeCloseTo(8, 1)

    const expected: Record<string, { w: number; h: number; audio: boolean }> = {
      '9x16': { w: 1080, h: 1920, audio: true },
      '16x9': { w: 1920, h: 1080, audio: true },
      '9x16_nomusic': { w: 1080, h: 1920, audio: false },
      '16x9_nomusic': { w: 1920, h: 1080, audio: false },
    }
    expect(Object.keys(result.videos).sort()).toEqual(Object.keys(expected).sort())
    for (const [variant, want] of Object.entries(expected)) {
      const p = await runFfprobe(result.videos[variant])
      expect(p.width, variant).toBe(want.w)
      expect(p.height, variant).toBe(want.h)
      expect(p.hasAudio, variant).toBe(want.audio)
      expect(p.duration, variant).toBeGreaterThan(7.5)
      expect(p.duration, variant).toBeLessThan(8.6)
    }
    const poster = await sharp(result.poster).metadata()
    expect(poster.width).toBe(1080)
  }, 240000)

  it('fails when too few photos load', async () => {
    const d = await mkdtemp(path.join(tmpdir(), 'reel-golden-fail-'))
    try {
      await expect(
        renderReel({ ...spec, items: spec.items.slice(0, 2), ratios: ['9x16'] }, {
          workDir: d,
          assetsDir,
          fetchBuffer: async () => fakePhoto(1, 800, 600),
        }),
      ).rejects.toThrow(/usable photos/)
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  }, 120000)
})
