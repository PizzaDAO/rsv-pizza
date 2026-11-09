import { rm } from 'node:fs/promises'
import type { Config } from './config.js'
import type { Queue, Job } from './queue.js'
import { renderReel } from './render.js'
import { assertOutputPrefix, type Storage } from './storage.js'
import type { ReelOutputs } from './types.js'

/** Run one claimed job end to end: render, upload, mark done or failed. Never throws. */
export async function processJob(job: Job, deps: { cfg: Config; queue: Queue; storage: Storage; log?: (m: string) => void }): Promise<'ready' | 'queued' | 'failed'> {
  const log = deps.log ?? console.log
  const { cfg, queue, storage } = deps
  let lastPct = -10
  try {
    assertOutputPrefix(job.spec.outputPrefix)
    const result = await renderReel(job.spec, {
      workDir: cfg.workDir,
      assetsDir: cfg.assetsDir,
      fetchMusic: job.spec.music ? (key, dest) => storage.getMusic(key, dest) : undefined,
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
      outputs[variant] = await storage.putFile(`${job.spec.outputPrefix}/${variant}.mp4`, file, 'video/mp4')
    }
    outputs.poster = await storage.putFile(`${job.spec.outputPrefix}/poster.jpg`, result.poster, 'image/jpeg')
    await queue.done(job.id, outputs)
    log(`[${job.id}] ready (${result.seconds}s, ${result.skipped} photos skipped)`)
    return 'ready'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`[${job.id}] failed: ${msg}`)
    return queue.fail(job.id, job.attempts, msg)
  } finally {
    await rm(`${cfg.workDir}/${job.spec.reelId}`, { recursive: true, force: true }).catch(() => {})
  }
}
