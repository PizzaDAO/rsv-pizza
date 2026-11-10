/**
 * Reel worker entrypoint: HTTP /health for Railway, plus a poll loop (concurrency 1)
 * that claims queued rows from the `reels` table and renders them.
 *
 * POST /wake (Authorization: Bearer $REEL_WORKER_SECRET) makes the loop poll right
 * away; the backend calls it after queueing a reel. Polling still works without it.
 */
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { loadConfig } from './config.js'
import { createQueue } from './queue.js'
import { createStorage } from './storage.js'
import { processJob } from './job.js'
import { killAllChildren } from './ffmpeg.js'

const cfg = loadConfig()
const queue = createQueue({
  databaseUrl: cfg.databaseUrl,
  ssl: cfg.dbSsl,
  maxAttempts: cfg.maxAttempts,
  staleMinutes: cfg.staleMinutes,
})
const storage = createStorage(cfg)

let busy = false
let wake: (() => void) | null = null
let stopping = false
let lastJobAt: string | null = null
let currentJobId: string | null = null

function authorized(header: string | undefined): boolean {
  const want = Buffer.from(`Bearer ${cfg.workerSecret}`)
  const got = Buffer.from(header ?? '')
  return got.length === want.length && timingSafeEqual(got, want)
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, busy, lastJobAt }))
    return
  }
  if (req.method === 'POST' && req.url === '/wake') {
    if (!authorized(req.headers.authorization)) {
      res.writeHead(401).end()
      return
    }
    wake?.()
    res.writeHead(202).end()
    return
  }
  res.writeHead(404).end()
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      wake = null
      resolve()
    }
    wake = done
  })
}

async function loop(): Promise<void> {
  await mkdir(cfg.workDir, { recursive: true })
  while (!stopping) {
    try {
      await queue.failExhaustedStale()
      const job = await queue.claim()
      if (job) {
        busy = true
        currentJobId = job.id
        await processJob(job, { cfg, queue, storage, isStopping: () => stopping })
        lastJobAt = new Date().toISOString()
        busy = false
        currentJobId = null
        continue
      }
    } catch (err) {
      busy = false
      console.error('poll error', err)
    }
    await sleep(cfg.pollMs)
  }
}

server.listen(cfg.port, () => console.log(`reel-worker listening on :${cfg.port}`))
void loop()

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true
    wake?.()
    server.close()
    killAllChildren()
    // Hand the in-flight row back (attempt not counted) so the next worker picks it up at once.
    const requeue = currentJobId ? queue.requeue(currentJobId).catch((e) => console.error('requeue failed', e)) : Promise.resolve()
    void Promise.race([requeue, new Promise((r) => setTimeout(r, 4000))]).then(() => process.exit(0))
  })
}
