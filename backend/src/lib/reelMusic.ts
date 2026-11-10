/**
 * Music for sizzle reels: PizzaDAO's own library (the pizza-radio R2 bucket,
 * keys `songs/<folder>/<file>`). Which folders/tracks are eligible is an admin
 * setting (ReelSettings). The backend only lists keys; the worker downloads.
 *
 * Env (read-only creds for the music bucket):
 *   REEL_MUSIC_R2_ENDPOINT, REEL_MUSIC_R2_ACCESS_KEY_ID,
 *   REEL_MUSIC_R2_SECRET_ACCESS_KEY, REEL_MUSIC_R2_BUCKET
 */
import type { ReelSettings } from './reelConfig.js';

export interface MusicTrack {
  key: string;
  folder: string;
  title: string;
}

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|flac|aac)$/i;
const SAFE_KEY = /^songs\/[^/]+(\/[^/]+)*$/;

export function isSafeTrackKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length < 300 &&
    SAFE_KEY.test(key) &&
    !key.split('/').some((seg) => seg === '..' || seg === '.') &&
    AUDIO_EXT.test(key)
  );
}

export function trackFromKey(key: string): MusicTrack {
  const parts = key.split('/');
  const file = parts[parts.length - 1];
  const folder = parts.length > 2 ? parts.slice(1, -1).join('/') : '';
  const title = file.replace(AUDIO_EXT, '').replace(/_+/g, ' ').trim();
  return { key, folder, title };
}

type MusicSettings = Pick<ReelSettings, 'musicFolders' | 'allowedTracks' | 'blockedTracks'>;

/**
 * Apply the admin config to a raw key listing. A track is offered if it is not
 * blocked and either is on the explicit allow-list, or sits in an allowed folder.
 * With no folders and no allow-list nothing is offered.
 */
export function filterEligibleTracks(keys: string[], s: MusicSettings): MusicTrack[] {
  const folders = new Set(s.musicFolders);
  const allowed = new Set(s.allowedTracks);
  const blocked = new Set(s.blockedTracks);
  return keys
    .filter(isSafeTrackKey)
    .filter((k) => !blocked.has(k))
    .map(trackFromKey)
    .filter((t) => allowed.has(t.key) || (t.folder !== '' && folders.has(t.folder.split('/')[0])))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Deterministic "auto" pick so the same reel id always gets the same song. */
export function pickAutoTrack(tracks: MusicTrack[], seed: string): MusicTrack | null {
  if (!tracks.length) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return tracks[h % tracks.length];
}

let cache: { keys: string[]; expires: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export function musicLibraryConfigured(): boolean {
  return !!(
    process.env.REEL_MUSIC_R2_ENDPOINT &&
    process.env.REEL_MUSIC_R2_ACCESS_KEY_ID &&
    process.env.REEL_MUSIC_R2_SECRET_ACCESS_KEY &&
    process.env.REEL_MUSIC_R2_BUCKET
  );
}

/** List every audio key under `songs/` in the music bucket (cached 10 min). Empty if not configured. */
export async function listMusicLibraryKeys(force = false): Promise<string[]> {
  if (!musicLibraryConfigured()) return [];
  if (!force && cache && cache.expires > Date.now()) return cache.keys;
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.REEL_MUSIC_R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.REEL_MUSIC_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.REEL_MUSIC_R2_SECRET_ACCESS_KEY!,
    },
  });
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.REEL_MUSIC_R2_BUCKET, Prefix: 'songs/', ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) if (o.Key && isSafeTrackKey(o.Key)) keys.push(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  cache = { keys, expires: Date.now() + CACHE_MS };
  return keys;
}
