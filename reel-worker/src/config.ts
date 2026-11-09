import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  port: number
  databaseUrl: string
  dbSsl: boolean
  workerSecret: string
  pollMs: number
  maxAttempts: number
  staleMinutes: number
  workDir: string
  assetsDir: string
  r2: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  music: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  /** Public base URL for the output bucket (custom domain or r2.dev), no trailing slash. */
  publicBaseUrl: string
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

const here = path.dirname(fileURLToPath(import.meta.url))

export function loadConfig(env = process.env): Config {
  const get = (n: string) => env[n] || ''
  const r2 = {
    endpoint: required('R2_ENDPOINT'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucket: required('R2_BUCKET_NAME'),
  }
  return {
    port: Number(get('PORT')) || 3000,
    databaseUrl: required('DATABASE_URL'),
    dbSsl: get('REEL_DB_SSL') !== 'false',
    workerSecret: required('REEL_WORKER_SECRET'),
    pollMs: Number(get('REEL_POLL_MS')) || 5000,
    maxAttempts: Number(get('REEL_MAX_ATTEMPTS')) || 2,
    staleMinutes: Number(get('REEL_STALE_MINUTES')) || 20,
    workDir: get('REEL_WORK_DIR') || '/tmp/reels',
    assetsDir: get('ASSETS_DIR') || path.resolve(here, '../assets'),
    r2,
    // The music library lives in the pizza-radio bucket; same account by default, own bucket name.
    music: {
      endpoint: get('REEL_MUSIC_R2_ENDPOINT') || r2.endpoint,
      accessKeyId: get('REEL_MUSIC_R2_ACCESS_KEY_ID') || r2.accessKeyId,
      secretAccessKey: get('REEL_MUSIC_R2_SECRET_ACCESS_KEY') || r2.secretAccessKey,
      bucket: get('REEL_MUSIC_R2_BUCKET'),
    },
    publicBaseUrl: required('REEL_PUBLIC_BASE_URL').replace(/\/+$/, ''),
  }
}
