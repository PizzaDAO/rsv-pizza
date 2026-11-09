/** Postgres-backed job queue over the `reels` table. No Redis; claim with FOR UPDATE SKIP LOCKED. */
import pg from 'pg'
import type { ReelOutputs, ReelSpec } from './types.js'

export interface Job {
  id: string
  spec: ReelSpec
  attempts: number
}

export interface Queue {
  claim(): Promise<Job | null>
  progress(id: string, pct: number): Promise<void>
  done(id: string, outputs: ReelOutputs): Promise<void>
  /** Requeue while attempts remain, else mark failed. */
  fail(id: string, attempts: number, message: string): Promise<'queued' | 'failed'>
  failExhaustedStale(): Promise<number>
  close(): Promise<void>
}

export const CLAIM_SQL = `
UPDATE reels SET status = 'rendering', started_at = now(), attempts = attempts + 1, progress = 0, error = NULL
WHERE id = (
  SELECT id FROM reels
  WHERE status = 'queued'
     OR (status = 'rendering' AND started_at < now() - ($2::int * interval '1 minute') AND attempts < $1::int)
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, spec, attempts`

export const FAIL_STALE_SQL = `
UPDATE reels SET status = 'failed', finished_at = now(), error = 'worker stopped before finishing'
WHERE status = 'rendering' AND started_at < now() - ($2::int * interval '1 minute') AND attempts >= $1::int`

export function createQueue(opts: { databaseUrl: string; ssl: boolean; maxAttempts: number; staleMinutes: number }): Queue {
  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: 2,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
  })
  return {
    async claim() {
      const r = await pool.query(CLAIM_SQL, [opts.maxAttempts, opts.staleMinutes])
      if (!r.rows.length) return null
      return { id: r.rows[0].id, spec: r.rows[0].spec as ReelSpec, attempts: r.rows[0].attempts }
    },
    async progress(id, pct) {
      await pool.query(`UPDATE reels SET progress = $2 WHERE id = $1 AND status = 'rendering'`, [id, Math.max(0, Math.min(99, Math.round(pct)))])
    },
    async done(id, outputs) {
      await pool.query(
        `UPDATE reels SET status = 'ready', outputs = $2::jsonb, progress = 100, error = NULL, finished_at = now() WHERE id = $1`,
        [id, JSON.stringify(outputs)],
      )
    },
    async fail(id, attempts, message) {
      const msg = message.slice(0, 1000)
      if (attempts < opts.maxAttempts) {
        await pool.query(`UPDATE reels SET status = 'queued', error = $2 WHERE id = $1`, [id, msg])
        return 'queued'
      }
      await pool.query(`UPDATE reels SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [id, msg])
      return 'failed'
    },
    async failExhaustedStale() {
      const r = await pool.query(FAIL_STALE_SQL, [opts.maxAttempts, opts.staleMinutes])
      return r.rowCount ?? 0
    },
    close: () => pool.end(),
  }
}
