// Hackathon public gallery, project pages and TV display (plans/hackathon-platform.md §8, PR 6).
// Backend: backend/src/routes/hackathon-gallery.routes.ts, display.routes.ts (+ lib/hackathon/gallery.ts).
import { apiRequest } from './api';
import { ordinal, type HackathonTrack, type PublicWinner } from './hackathonApi';

export interface ProjectAward {
  prizeName: string;
  prizeAmount: string | null;
  trackName: string | null;
  place: number | null;
  /** Prize has quantity > 1, so the place is worth showing. */
  multi: boolean;
}

export interface GalleryProject {
  slug: string;
  name: string;
  tagline: string | null;
  trackIds: string[];
  /** Short-lived signed URL (or null). */
  cover: string | null;
  teamName: string | null;
  tableNumber: string | null;
  awards: ProjectAward[];
}

export interface ProjectDetail extends GalleryProject {
  description: string | null;
  links: { repoUrl: string | null; demoVideoUrl: string | null; deckUrl: string | null; liveUrl: string | null };
  screenshots: string[];
  members: Array<{ name: string; avatarUrl: string | null }>;
  submittedAt: string | null;
  /** Previews only (host, own team). */
  status?: 'draft' | 'submitted' | 'disqualified' | 'withdrawn';
}

interface GalleryMeta {
  galleryOpen: boolean;
  galleryVisibility?: 'hidden' | 'after_deadline' | 'after_reveal';
  opensAfter: 'deadline' | 'reveal' | null;
  submissionDeadline?: string | null;
  resultsRevealedAt?: string | null;
}

export interface GalleryResponse extends GalleryMeta {
  available: boolean;
  /** Host viewing before the public can. */
  preview: boolean;
  canManage?: boolean;
  tracks: Array<Pick<HackathonTrack, 'id' | 'name' | 'description' | 'sponsorName'>>;
  projects: GalleryProject[];
}

export interface ProjectResponse extends GalleryMeta {
  preview: boolean;
  canManage: boolean;
  tracks: Array<{ id: string; name: string }>;
  project: ProjectDetail;
}

const base = (partyId: string) => `/api/parties/${partyId}/hackathon`;

export function getGallery(partyId: string) {
  return apiRequest<GalleryResponse>(`${base(partyId)}/gallery`, { requireAuth: false });
}

export function getProject(partyId: string, projectSlug: string) {
  return apiRequest<ProjectResponse>(`${base(partyId)}/projects/${encodeURIComponent(projectSlug)}`, { requireAuth: false });
}

// ---------------------------------------------------------------- display

export type HackathonDisplayMode = 'auto' | 'countdown' | 'gallery' | 'winners';

export interface HackathonDisplayConfig {
  mode?: HackathonDisplayMode;
  showQr?: boolean;
}

/** PR 5's public winner (awards.publicWinners) + the place flag and a cover for the TV. */
export interface DisplayWinner extends ProjectAward, Pick<PublicWinner, 'projectName' | 'projectTagline' | 'teamName'> {
  projectSlug: string;
  cover: string | null;
}

export interface DisplayHackathonData {
  submissionsOpenAt: string | null;
  submissionDeadline: string | null;
  resultsRevealedAt: string | null;
  galleryOpen: boolean;
  tracks: Array<{ id: string; name: string }>;
  projects: GalleryProject[];
  winners: DisplayWinner[];
}

export async function getDisplayHackathon(partyId: string, slug: string) {
  return apiRequest<{ hackathon: DisplayHackathonData | null }>(`/api/display/view/${partyId}/${encodeURIComponent(slug)}/hackathon`, { requireAuth: false });
}

/** Mirrors lib/hackathon/gallery.ts resolveDisplayMode. */
export function resolveDisplayMode(mode: HackathonDisplayMode | undefined, d: DisplayHackathonData | null): 'countdown' | 'gallery' | 'winners' {
  const m = mode ?? 'auto';
  if (m !== 'auto') return m;
  if (d?.resultsRevealedAt && d.winners.length > 0) return 'winners';
  if (d?.galleryOpen && d.projects.length > 0) return 'gallery';
  return 'countdown';
}

// ---------------------------------------------------------------- helpers

export function awardLabel(a: ProjectAward): string {
  return `${a.prizeName}${a.multi && a.place ? ` · ${ordinal(a.place)}` : ''}`;
}

/**
 * Embeddable player URL for an allowlisted video host (YouTube, Vimeo, Loom), else null (the
 * link is shown as a plain link). Ids are pattern-checked, so nothing user-controlled reaches
 * the iframe src except a validated id.
 */
export function videoEmbedUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const id = (v: string | null | undefined, re: RegExp) => (v && re.test(v) ? v : null);
  if (host === 'youtu.be') {
    const v = id(u.pathname.slice(1).split('/')[0], /^[A-Za-z0-9_-]{6,20}$/);
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === 'youtube.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const raw = parts[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    const v = id(raw, /^[A-Za-z0-9_-]{6,20}$/);
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const v = id(parts[0] === 'video' ? parts[1] : parts[0], /^\d{4,12}$/);
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  if (host === 'loom.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const v = ['share', 'embed'].includes(parts[0]) ? id(parts[1], /^[a-f0-9]{16,40}$/) : null;
    return v ? `https://www.loom.com/embed/${v}` : null;
  }
  return null;
}

/** Host name for link chips ("github.com"). */
export function linkHost(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}
