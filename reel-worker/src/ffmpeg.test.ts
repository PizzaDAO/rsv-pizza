import { describe, it, expect } from 'vitest'
import {
  buildClipArgs, buildMuxArgs, buildPosterArgs, buildXfadeArgs, DIMENSIONS, framesFor,
  kenBurnsMotion, xfadeOffsets, xfadeTotal,
} from './ffmpeg.js'

describe('xfade math', () => {
  it('computes offsets that overlap by the transition time', () => {
    // clips 3s, 2s, 2s, 4s with 0.5s transitions
    expect(xfadeOffsets([3, 2, 2, 4], 0.5)).toEqual([2.5, 4, 5.5])
    expect(xfadeTotal([3, 2, 2, 4], 0.5)).toBe(9.5)
  })
  it('handles one clip', () => {
    expect(xfadeOffsets([5], 0.5)).toEqual([])
    expect(xfadeTotal([5], 0.5)).toBe(5)
  })
})

describe('kenBurnsMotion', () => {
  it('is deterministic and cycles through different moves', () => {
    expect(kenBurnsMotion(1, 75)).toEqual(kenBurnsMotion(1, 75))
    const seen = new Set(Array.from({ length: 6 }, (_, i) => JSON.stringify(kenBurnsMotion(i, 75))))
    expect(seen.size).toBe(6)
    expect(kenBurnsMotion(6, 75)).toEqual(kenBurnsMotion(0, 75))
  })
  it('zooms in by default and out for the zoom-out move', () => {
    expect(kenBurnsMotion(0, 61).z).toBe('1+0.12*on/60')
    expect(kenBurnsMotion(3, 61).z).toBe('1.12-0.12*on/60')
  })
  it('is gentler when subtle', () => {
    expect(kenBurnsMotion(0, 61, true).z).toBe('1+0.04*on/60')
  })
})

describe('buildClipArgs', () => {
  it('targets the right size and frame count for each ratio', () => {
    const a = buildClipArgs({ image: 'in.jpg', out: 'out.mp4', ratio: '9x16', seconds: 2.5, index: 0 })
    const vf = a[a.indexOf('-vf') + 1]
    expect(vf).toContain('s=1080x1920')
    expect(vf).toContain('d=75')
    expect(a[a.indexOf('-frames:v') + 1]).toBe('75')
    expect(a.at(-1)).toBe('out.mp4')
    const b = buildClipArgs({ image: 'in.jpg', out: 'o.mp4', ratio: '16x9', seconds: 2, index: 1 })
    expect(b[b.indexOf('-vf') + 1]).toContain('s=1920x1080')
  })
  it('uses h264 yuv420p with no audio', () => {
    const a = buildClipArgs({ image: 'i', out: 'o', ratio: '9x16', seconds: 1, index: 0 })
    expect(a).toContain('libx264')
    expect(a).toContain('yuv420p')
    expect(a).toContain('-an')
  })
  it('exposes both required dimensions', () => {
    expect(DIMENSIONS['9x16']).toEqual({ w: 1080, h: 1920 })
    expect(DIMENSIONS['16x9']).toEqual({ w: 1920, h: 1080 })
    expect(framesFor(2.5)).toBe(75)
  })
})

describe('buildXfadeArgs', () => {
  const clips = [
    { file: 'a.mp4', seconds: 3 },
    { file: 'b.mp4', seconds: 2 },
    { file: 'c.mp4', seconds: 4 },
  ]
  it('chains xfade filters with the computed offsets and maps the final label', () => {
    const a = buildXfadeArgs(clips, 0.5, 'master.mp4')
    const fc = a[a.indexOf('-filter_complex') + 1]
    expect(fc).toBe(
      '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=2.5[x1];' +
        '[x1][2:v]xfade=transition=slideleft:duration=0.5:offset=4[vout]',
    )
    expect(a[a.indexOf('-map') + 1]).toBe('[vout]')
    expect(a.filter((x) => x === '-i')).toHaveLength(3)
    expect(a.at(-1)).toBe('master.mp4')
  })
  it('skips the filter for a single clip and rejects none', () => {
    expect(buildXfadeArgs([clips[0]], 0.5, 'o.mp4')).not.toContain('-filter_complex')
    expect(() => buildXfadeArgs([], 0.5, 'o.mp4')).toThrow()
  })
})

describe('buildMuxArgs', () => {
  it('loops, normalises, fades and copies video', () => {
    const a = buildMuxArgs({ video: 'v.mp4', music: 'm', out: 'o.mp4', seconds: 30 })
    const fc = a[a.indexOf('-filter_complex') + 1]
    expect(fc).toContain('loudnorm')
    expect(fc).toContain('afade=t=out:st=28:d=2')
    expect(fc).toContain('atrim=0:30')
    expect(a.slice(a.indexOf('-stream_loop'), a.indexOf('-stream_loop') + 3)).toEqual(['-stream_loop', '-1', '-i'])
    expect(a[a.indexOf('-c:v') + 1]).toBe('copy')
    expect(a[a.indexOf('-t') + 1]).toBe('30')
  })
})

describe('buildPosterArgs', () => {
  it('grabs a single frame', () => {
    expect(buildPosterArgs('v.mp4', 'p.jpg', 3.5)).toEqual(['-y', '-ss', '3.5', '-i', 'v.mp4', '-frames:v', '1', '-q:v', '3', 'p.jpg'])
  })
})
