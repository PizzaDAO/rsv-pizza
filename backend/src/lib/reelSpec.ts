/**
 * The self-contained render spec stored in reels.spec. The reel-worker reads
 * only this (plus env), so it never needs the Photo/Sponsor tables.
 * Keep in sync with reel-worker/src/types.ts.
 */
import type { ReelSettings } from './reelConfig.js';
import { planTimeline, type Timeline } from './reelSelection.js';

export type ReelRatio = '9x16' | '16x9';
export const ALL_RATIOS: ReelRatio[] = ['9x16', '16x9'];

export interface ReelSpec {
  version: 1;
  reelId: string;
  partyId: string;
  /** Event name shown on the title card (host-editable). */
  title: string;
  city: string | null;
  dateLabel: string | null;
  guestCount: number | null;
  /** Bare site domain shown on the end card, from the brand config. */
  siteDomain: string;
  ratios: ReelRatio[];
  items: Array<{ id: string; url: string }>;
  sponsors: Array<{ id: string; name: string; logoUrl: string }>;
  /** Global Pizza Party logo (series logo). Worker falls back to its bundled brand art. */
  gppLogoUrl: string | null;
  /** Music track key in the music bucket, or null for no-music only. A no-music version is always rendered too. */
  music: { key: string; title: string } | null;
  timeline: Timeline;
  brand: ReelSettings['brand'];
  /** R2 key prefix for outputs: reels/<partyId>/<reelId> */
  outputPrefix: string;
}

export function formatReelDate(date: Date | null, timezone?: string | null): string | null {
  if (!date) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone || 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date);
  }
}

export function cleanTitle(raw: unknown, fallback: string): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return t || fallback.slice(0, 80);
}

export interface BuildSpecInput {
  reelId: string;
  partyId: string;
  title: string;
  city: string | null;
  date: Date | null;
  timezone: string | null;
  guestCount: number | null;
  siteDomain: string;
  ratios?: ReelRatio[];
  photos: Array<{ id: string; url: string }>;
  sponsors: Array<{ id: string; name: string; logoUrl: string | null }>;
  gppLogoUrl: string | null;
  music: { key: string; title: string } | null;
  settings: ReelSettings;
}

export function buildReelSpec(i: BuildSpecInput): ReelSpec {
  const ratios = (i.ratios ?? ALL_RATIOS).filter((r) => ALL_RATIOS.includes(r));
  return {
    version: 1,
    reelId: i.reelId,
    partyId: i.partyId,
    title: i.title,
    city: i.city?.trim() || null,
    dateLabel: formatReelDate(i.date, i.timezone),
    guestCount: i.guestCount && i.guestCount > 0 ? i.guestCount : null,
    siteDomain: i.siteDomain,
    ratios: ratios.length ? ratios : ALL_RATIOS,
    items: i.photos.map((p) => ({ id: p.id, url: p.url })),
    sponsors: i.sponsors
      .filter((s): s is { id: string; name: string; logoUrl: string } => !!s.logoUrl && /^https?:\/\//i.test(s.logoUrl))
      .slice(0, 12),
    gppLogoUrl: i.gppLogoUrl && /^https?:\/\//i.test(i.gppLogoUrl) ? i.gppLogoUrl : null,
    music: i.music,
    timeline: planTimeline({
      count: i.photos.length,
      targetSeconds: i.settings.targetSeconds,
      maxSeconds: i.settings.maxSeconds,
    }),
    brand: i.settings.brand,
    outputPrefix: `reels/${i.partyId}/${i.reelId}`,
  };
}
