// Sizzle reels: host + admin API calls (backend/src/routes/reel.routes.ts).
import { apiRequest } from './api';

export type ReelStatus = 'queued' | 'rendering' | 'ready' | 'failed';

export interface ReelItem {
  id: string;
  status: ReelStatus;
  progress: number;
  /** Present when ready: 9x16, 16x9, 9x16_nomusic, 16x9_nomusic, poster (URLs). */
  outputs: Record<string, string> | null;
  error: string | null;
  title: string | null;
  musicTitle: string | null;
  durationSeconds: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ReelTrack {
  key: string;
  title: string;
  folder: string;
}

export interface ReelsOverview {
  eligible: boolean;
  reason: string | null;
  reasonCode: string | null;
  photoCount: number;
  minPhotos: number;
  tracks: ReelTrack[];
  reels: ReelItem[];
}

export interface MakeReelOptions {
  title?: string;
  /** 'auto' (default), 'none' (no music), or a track key. */
  musicKey?: string;
  photoIds?: string[];
}

export const isReelActive = (r: Pick<ReelItem, 'status'>): boolean => r.status === 'queued' || r.status === 'rendering';

export function fetchReels(partyId: string): Promise<ReelsOverview> {
  return apiRequest<ReelsOverview>(`/api/parties/${partyId}/reels`);
}

export async function makeReel(partyId: string, options: MakeReelOptions): Promise<ReelItem> {
  const res = await apiRequest<{ reel: ReelItem }>(`/api/parties/${partyId}/reels`, { method: 'POST', body: options });
  return res.reel;
}

// ---- admin
export interface ReelSettings {
  enabled: boolean;
  targetSeconds: number;
  maxSeconds: number;
  maxPhotos: number;
  minPhotos: number;
  perUserDailyLimit: number;
  maxActivePerParty: number;
  musicFolders: string[];
  allowedTracks: string[];
  blockedTracks: string[];
  brand: { red: string; sky: string; yellow: string; ink: string };
}

export interface MusicLibrary {
  configured: boolean;
  folders: string[];
  tracks: Array<ReelTrack & { eligible: boolean }>;
}

export function fetchReelSettings(): Promise<{ settings: ReelSettings; musicLibraryConfigured: boolean }> {
  return apiRequest('/api/admin/reels/settings');
}

export async function saveReelSettings(settings: ReelSettings): Promise<ReelSettings> {
  const res = await apiRequest<{ settings: ReelSettings }>('/api/admin/reels/settings', { method: 'PUT', body: { settings } });
  return res.settings;
}

export function fetchMusicLibrary(): Promise<MusicLibrary> {
  return apiRequest('/api/admin/reels/music-library');
}
