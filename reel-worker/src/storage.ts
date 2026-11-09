import { readFile, writeFile } from 'node:fs/promises'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Config } from './config.js'

const PREFIX_RE = /^reels\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9-]{8,64}$/
const MUSIC_KEY_RE = /^songs\/[^/]+(\/[^/]+)*\.(mp3|m4a|wav|ogg|flac|aac)$/i

/** Output keys must stay under reels/<partyId>/<reelId>. */
export function assertOutputPrefix(prefix: string): void {
  if (!PREFIX_RE.test(prefix)) throw new Error(`refusing output prefix "${prefix}"`)
}

/** Music keys come from the spec; only read audio under songs/ with no traversal. */
export function assertMusicKey(key: string): void {
  if (!MUSIC_KEY_RE.test(key) || key.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error(`refusing music key "${key}"`)
  }
}

export interface Storage {
  putFile(key: string, file: string, contentType: string): Promise<string>
  getMusic(key: string, dest: string): Promise<void>
}

export function createStorage(cfg: Config): Storage {
  const out = new S3Client({
    region: 'auto',
    endpoint: cfg.r2.endpoint,
    credentials: { accessKeyId: cfg.r2.accessKeyId, secretAccessKey: cfg.r2.secretAccessKey },
  })
  const music = new S3Client({
    region: 'auto',
    endpoint: cfg.music.endpoint,
    credentials: { accessKeyId: cfg.music.accessKeyId, secretAccessKey: cfg.music.secretAccessKey },
  })
  return {
    async putFile(key, file, contentType) {
      const body = await readFile(file)
      await out.send(
        new PutObjectCommand({
          Bucket: cfg.r2.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
      return `${cfg.publicBaseUrl}/${key}`
    },
    async getMusic(key, dest) {
      assertMusicKey(key)
      if (!cfg.music.bucket) throw new Error('REEL_MUSIC_R2_BUCKET is not set')
      const res = await music.send(new GetObjectCommand({ Bucket: cfg.music.bucket, Key: key }))
      if (!res.Body) throw new Error('empty music object')
      await writeFile(dest, Buffer.from(await res.Body.transformToByteArray()))
    },
  }
}
