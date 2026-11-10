import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import sharp from 'sharp'
import { isPrivateIp, safeGet } from './safeFetch.js'
import { assertSvgSafe, logoToPng, normalizePhoto, rasterizeUntrustedSvg, PHOTO_MAX_EDGE } from './media.js'
import { validateSpec, processJob } from './job.js'
import { jobDeadlineMs } from './config.js'
import { runFfmpeg } from './ffmpeg.js'
import type { Config } from './config.js'
import type { Queue } from './queue.js'
import type { ReelSpec } from './types.js'

const assetsDir = new URL('../assets', import.meta.url).pathname

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
  ])('blocks %s', (ip) => expect(isPrivateIp(ip)).toBe(true))
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) => expect(isPrivateIp(ip)).toBe(false))
})

describe('safeFetch', () => {
  it('refuses loopback servers, including via hostname', async () => {
    const hit = vi.fn()
    const srv = http.createServer((_q, r) => { hit(); r.end('secret') })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    try {
      await expect(safeGet(`http://127.0.0.1:${port}/x`, { maxBytes: 1000 })).rejects.toThrow(/blocked/)
      await expect(safeGet(`http://localhost:${port}/x`, { maxBytes: 1000 })).rejects.toThrow(/blocked/)
      expect(hit).not.toHaveBeenCalled()
    } finally {
      srv.close()
    }
  })
  it('enforces the origin allow-list and rejects odd schemes and credentials', async () => {
    await expect(safeGet('https://evil.example.com/a.jpg', { maxBytes: 10, allowedOrigins: ['https://storage.example.com'] })).rejects.toThrow(/origin/)
    await expect(safeGet('file:///etc/passwd', { maxBytes: 10 })).rejects.toThrow(/scheme/)
    await expect(safeGet('https://u:p@example.com/a', { maxBytes: 10 })).rejects.toThrow(/credentials/)
  })
})

describe('image limits', () => {
  it('downscales big photos on download', async () => {
    const big = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: '#888' } }).jpeg().toBuffer()
    const out = await normalizePhoto(big)
    const m = await sharp(out).metadata()
    expect(Math.max(m.width!, m.height!)).toBe(PHOTO_MAX_EDGE)
  })
  it('rejects decompression bombs over ~50MP', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer()
    await expect(normalizePhoto(bomb)).rejects.toThrow()
  }, 60000)
})

describe('untrusted SVG logos', () => {
  const ok = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#0a7"/></svg>')
  it('rasterises a normal one', async () => {
    const ref = await logoToPng(ok, assetsDir)
    expect(ref.uri.startsWith('data:image/png;base64,')).toBe(true)
  })
  it('rejects oversized, complex and resource-loading svgs', () => {
    expect(() => assertSvgSafe(Buffer.alloc(600 * 1024, 'a'))).toThrow(/large/)
    expect(() => assertSvgSafe(Buffer.from('<svg>' + '<g/>'.repeat(6000) + '</svg>'))).toThrow(/complex/)
    expect(() => assertSvgSafe(Buffer.from('<svg><image href="http://169.254.169.254/x"/></svg>'))).toThrow(/unsupported/)
    expect(() => assertSvgSafe(Buffer.from('<svg><script>1</script></svg>'))).toThrow(/unsupported/)
  })
  it('refuses to render when the guard fails', async () => {
    await expect(rasterizeUntrustedSvg(Buffer.from('<svg><image href="x"/></svg>'), 100, assetsDir)).rejects.toThrow()
  })
})

describe('runFfmpeg timeout', () => {
  it('SIGKILLs a process that outlives its timeout', async () => {
    const t = Date.now()
    await expect(runFfmpeg(['-e', 'setTimeout(()=>{}, 30000)'], { bin: process.execPath, timeoutMs: 300 })).rejects.toThrow(/timed out/)
    expect(Date.now() - t).toBeLessThan(5000)
  })
})

const goodSpec = {
  reelId: '66666666-7777-8888-9999-000000000000',
  partyId: '11111111-2222-3333-4444-555555555555',
  outputPrefix: 'reels/11111111-2222-3333-4444-555555555555/66666666-7777-8888-9999-000000000000',
  items: [], ratios: ['9x16'], timeline: { titleSeconds: 1, endSeconds: 1, itemSeconds: 1, transitionSeconds: 0.5, totalSeconds: 3 },
} as unknown as ReelSpec

describe('validateSpec', () => {
  it('accepts a good spec', () => expect(validateSpec(goodSpec)).toBe(goodSpec.reelId))
  it.each([
    ['null', null],
    ['path traversal id', { ...goodSpec, reelId: '../../etc', outputPrefix: 'reels/x/../../etc' }],
    ['mismatched prefix', { ...goodSpec, outputPrefix: 'reels/11111111-2222-3333-4444-555555555555/aaaaaaaa-7777-8888-9999-000000000000' }],
  ])('rejects %s', (_n, spec) => expect(() => validateSpec(spec as ReelSpec)).toThrow())
})

function fakeQueue() {
  const q = { fail: vi.fn(async () => 'failed' as const), done: vi.fn(), progress: vi.fn(async () => {}) }
  return q as unknown as Queue & typeof q
}
const cfg = { workDir: '/tmp/reel-hardening', assetsDir, photoOrigins: ['https://storage.example.com'], jobDeadlineMs: 400 } as unknown as Config

describe('processJob', () => {
  it('does not throw on a null spec and marks the job failed', async () => {
    const queue = fakeQueue()
    const r = await processJob({ id: 'j', spec: null as unknown as ReelSpec, attempts: 2 }, { cfg, queue, storage: {} as never, log: () => {} })
    expect(r).toBe('failed')
    expect(queue.fail).toHaveBeenCalledOnce()
  })
  it('fails a hung job at the deadline instead of blocking the loop', async () => {
    const queue = fakeQueue()
    const storage = { getMusic: () => new Promise(() => {}), putFile: vi.fn() } as never
    const spec = { ...goodSpec, music: { key: 'songs/a/b.mp3', title: 'b' }, sponsors: [], gppLogoUrl: null, brand: {}, title: 't', city: null, dateLabel: null, guestCount: null, siteDomain: 'example.com' } as unknown as ReelSpec
    const t = Date.now()
    const r = await processJob({ id: 'j', spec, attempts: 2 }, { cfg, queue, storage, log: () => {} })
    expect(r).toBe('failed')
    expect(Date.now() - t).toBeLessThan(3000)
  })
  it('does not mark a job failed while shutting down', async () => {
    const queue = fakeQueue()
    const r = await processJob({ id: 'j', spec: null as unknown as ReelSpec, attempts: 1 }, { cfg, queue, storage: {} as never, log: () => {}, isStopping: () => true })
    expect(r).toBe('queued')
    expect(queue.fail).not.toHaveBeenCalled()
  })
})

describe('deadline vs stale reclaim', () => {
  it('stays below the stale window', () => {
    expect(jobDeadlineMs(20)).toBeLessThan(20 * 60_000)
    expect(jobDeadlineMs(20)).toBe(17 * 60_000)
    expect(jobDeadlineMs(2)).toBe(60_000)
  })
})
