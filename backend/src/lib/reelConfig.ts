/**
 * Sizzle reel settings (admin config, stored in app_config key `reels.settings`).
 * Tunables live in the DB, not constants: an admin can change them without a
 * deploy via PUT /api/admin/reels/settings. Everything is clamped on read.
 */
import { getConfig } from './privateConfig.js';

export const REEL_SETTINGS_KEY = 'reels.settings';

export interface ReelSettings {
  /** Master switch. */
  enabled: boolean;
  /** Target reel length in seconds (title + photos + end card). */
  targetSeconds: number;
  /** Hard cap on reel length in seconds. */
  maxSeconds: number;
  /** Max photos used per reel (12-15 is the default sweet spot). */
  maxPhotos: number;
  /** Min usable photos required to make a reel. */
  minPhotos: number;
  /** Reels one user may request per rolling 24h. */
  perUserDailyLimit: number;
  /** Reels one party may have queued/rendering at once. */
  maxActivePerParty: number;
  /** Music library folders (under `songs/`) hosts may pick from. Empty = no music offered. */
  musicFolders: string[];
  /** Optional explicit allow-list of full track keys (`songs/<folder>/<file>`). Empty = every track in the folders. */
  allowedTracks: string[];
  /** Track keys never offered even if their folder is allowed. */
  blockedTracks: string[];
  /** Brand colors used on the title and end cards. */
  brand: { red: string; sky: string; yellow: string; ink: string };
}

export const DEFAULT_REEL_SETTINGS: ReelSettings = {
  // Off until an admin turns it on (PUT /api/admin/reels/settings).
  enabled: false,
  targetSeconds: 30,
  maxSeconds: 60,
  maxPhotos: 14,
  minPhotos: 3,
  perUserDailyLimit: 5,
  maxActivePerParty: 1,
  musicFolders: [],
  allowedTracks: [],
  blockedTracks: [],
  // GPP palette: matches --accent in frontend/src/index.css and the GPP flyer.
  brand: { red: '#ff393a', sky: '#7dd3f0', yellow: '#ffd800', ink: '#0b0b10' },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)),
  ).slice(0, 500);
}

/** Merge arbitrary input over the defaults, clamping every field to a sane range. */
export function normalizeReelSettings(input: unknown): ReelSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_REEL_SETTINGS;
  const maxSeconds = int(o.maxSeconds, d.maxSeconds, 15, 60);
  const brandIn = (o.brand && typeof o.brand === 'object' ? o.brand : {}) as Record<string, unknown>;
  const color = (k: keyof ReelSettings['brand']) =>
    typeof brandIn[k] === 'string' && HEX.test(brandIn[k] as string) ? (brandIn[k] as string) : d.brand[k];
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    targetSeconds: Math.min(int(o.targetSeconds, d.targetSeconds, 10, 60), maxSeconds),
    maxSeconds,
    maxPhotos: int(o.maxPhotos, d.maxPhotos, 3, 30),
    minPhotos: int(o.minPhotos, d.minPhotos, 1, 10),
    perUserDailyLimit: int(o.perUserDailyLimit, d.perUserDailyLimit, 1, 50),
    maxActivePerParty: int(o.maxActivePerParty, d.maxActivePerParty, 1, 5),
    musicFolders: Array.from(new Set(strList(o.musicFolders).map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean))),
    allowedTracks: strList(o.allowedTracks),
    blockedTracks: strList(o.blockedTracks),
    brand: { red: color('red'), sky: color('sky'), yellow: color('yellow'), ink: color('ink') },
  };
}

export async function getReelSettings(): Promise<ReelSettings> {
  const raw = await getConfig<unknown>(REEL_SETTINGS_KEY, {});
  return normalizeReelSettings(raw);
}
