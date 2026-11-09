import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { Config } from './config.js'
import type { Queue, Job } from './queue.js'
import { renderReel } from './render.js'
import { assertOutputPrefix, type Storage } from './storage.js'
import type { ReelOutputs, ReelSpec } from './types.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The ids become directory names and R2 keys, so they must be real UUIDs. Returns the safe reel id. */
export function validateSpec(spec: ReelSpec | null | undefined): string {
  if (!spec || typeof spec !== 'object') throw new Error('missing spec')
  if (typeof spec.reelId !== 'string' || !UUID_RE.test(spec.reelId)) throw new Error('invalid reelId')
  if (typeof spec.partyId !== 'string' || !UUID_RE.test(spec.partyId)) throw new Error('invalid partyId')
  if (spec.outputPrefix !== `reels/${spec.partyId}/${spec.reelId}`) throw new Error('outputPrefix does not match ids')
  assertOutputPrefix(spec.outputPrefix)
  if (!Array.isArray(spec.items) || !Array.isArray(spec.ratios) || !spec.timeline) throw new Error('malformed spec')
  return spec.reelId
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`job exceeded ${Math.round(ms / 1000)}s deadline`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** Run one claimed job end to end: render, upload, mark done or failed. Never throws. */
export async function processJob(
  job: Job,
  deps: { cfg: Config; queue: Queue; storage: Storage; log?: (m: string) => void; isStopping?: () => boolean },
): Promise<'ready' | 'queued' | 'failed'> {
  const log = deps.log ?? console.log
  const { cfg, queue, storage } = deps
  let lastPct = -10
  let safeId: string | null = null
  try {
    safeId = validateSpec(job.spec)
    const spec = job.spec
    const deadline = Date.now() + cfg.jobDeadlineMs
    const work = (async () => {
      const result = await renderReel(spec, {
        workDir: cfg.workDir,
        assetsDir: cfg.assetsDir,
        photoOrigins: cfg.photoOrigins,
        deadline,
        fetchMusic: spec.music ? (key, dest) => storage.getMusic(key, dest) : undefined,
        log: (m) => log(`[${job.id}] ${m}`),
        onProgress: (p) => {
          if (p - lastPct >= 5) {
            lastPct = p
            void queue.progress(job.id, p).catch(() => {})
          }
        },
      })
      const outputs: ReelOutputs = {}
      for (const [variant, file] of Object.entries(result.videos)) {
        outputs[variant] = await storage.putFile(`${spec.outputPrefix}/${variant}.mp4`, file, 'video/mp4')
      }
      outputs.poster = await storage.putFile(`${spec.outputPrefix}/poster.jpg`, result.poster, 'image/jpeg')
      await queue.done(job.id, outputs)
      log(`[${job.id}] ready (${result.seconds}s, ${result.skipped} photos skipped)`)
    })()
    // Swallow a late rejection if the deadline wins the race.
    work.catch(() => {})
    await withDeadline(work, cfg.jobDeadlineMs)
    return 'ready'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (deps.isStopping?.()) return 'queued' // shutdown: the row is requeued by the signal handler
    log(`[${job.id}] failed: ${msg}`)
    return queue.fail(job.id, job.attempts, msg).catch(() => 'failed' as const)
  } finally {
    if (safeId) await rm(path.join(cfg.workDir, safeId), { recursive: true, force: true }).catch(() => {})
  }
}
