// White-label event-series API client, extracted from lib/api.ts (first slice of
// decomposing that ~8k-line file). Re-exported from ./api so existing
// `import { ... } from '../lib/api'` call sites are unchanged. apiRequest is
// imported from ./api (hoisted; called at runtime, so the cycle resolves).
import { apiRequest } from './api';

// ---- White-label event series (admin) ----
export interface EventSeries {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  isActive: boolean;
  themeClass: string | null;
  logoUrl: string | null;
  ogImageUrl: string | null;
  flyerTemplateKey: string | null;
  description: string | null;
  eventType: string | null;
  publicTags: string[];
  internalTags: string[];
  requireApproval: boolean;
  hideGuests: boolean;
  photosEnabled: boolean;
  photosPublic: boolean;
  eventDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  fundingWalletAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesChecklistDefault {
  id: string;
  name: string;
  dueDate: string | null;
  isAuto: boolean;
  autoRule: string | null;
  linkTab: string | null;
  sortOrder: number;
  seriesId: string | null;
}

export type SeriesInput = Partial<Omit<EventSeries, 'id' | 'createdAt' | 'updatedAt'>> & { slug?: string; name?: string };

export async function fetchEventSeriesList(): Promise<{ series: EventSeries[] }> {
  return apiRequest<{ series: EventSeries[] }>('/api/admin/series');
}

export async function createEventSeries(data: SeriesInput): Promise<{ series: EventSeries }> {
  return apiRequest<{ series: EventSeries }>('/api/admin/series', { method: 'POST', body: data });
}

export async function updateEventSeries(id: string, data: SeriesInput): Promise<{ series: EventSeries }> {
  return apiRequest<{ series: EventSeries }>(`/api/admin/series/${id}`, { method: 'PATCH', body: data });
}

export async function fetchSeriesChecklist(seriesId: string): Promise<{ items: SeriesChecklistDefault[] }> {
  return apiRequest<{ items: SeriesChecklistDefault[] }>(`/api/admin/series/${seriesId}/checklist`);
}

export async function addSeriesChecklistDefault(
  seriesId: string,
  data: { name: string; dueDate?: string | null; linkTab?: string | null; isAuto?: boolean; autoRule?: string | null; sortOrder?: number },
): Promise<{ item: SeriesChecklistDefault }> {
  return apiRequest<{ item: SeriesChecklistDefault }>(`/api/admin/series/${seriesId}/checklist`, { method: 'POST', body: data });
}

export async function updateSeriesChecklistDefault(
  defaultId: string,
  data: { name?: string; dueDate?: string | null; linkTab?: string | null; isAuto?: boolean; autoRule?: string | null; sortOrder?: number },
): Promise<{ item: SeriesChecklistDefault }> {
  return apiRequest<{ item: SeriesChecklistDefault }>(`/api/admin/series/checklist/${defaultId}`, { method: 'PATCH', body: data });
}

export async function deleteSeriesChecklistDefault(defaultId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/admin/series/checklist/${defaultId}`, { method: 'DELETE' });
}

// ---- Public series (landing page) ----
export interface PublicSeries {
  slug: string;
  name: string;
  displayName: string;
  isActive: boolean;
  themeClass: string | null;
  logoUrl: string | null;
  ogImageUrl: string | null;
  description: string | null;
  eventType: string | null;
  publicTags: string[];
  requireApproval: boolean;
  hideGuests: boolean;
  photosEnabled: boolean;
  photosPublic: boolean;
  eventDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
}

export interface PublicSeriesEvent {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  date: string | null;
  latitude: number | null;
  longitude: number | null;
  eventImageUrl: string | null;
  slug: string;
  community: boolean;
}

export interface PublicSeriesWithId extends PublicSeries {
  id: string;
  flyerTemplateKey: string | null;
}

export async function fetchPublicSeriesList(): Promise<{ series: PublicSeriesWithId[] }> {
  return apiRequest<{ series: PublicSeriesWithId[] }>(`/api/series`, { requireAuth: false });
}

export async function fetchPublicSeries(slug: string): Promise<{ series: PublicSeries }> {
  return apiRequest<{ series: PublicSeries }>(`/api/series/${encodeURIComponent(slug)}`, { requireAuth: false });
}

export async function fetchPublicSeriesEvents(slug: string): Promise<{ events: PublicSeriesEvent[] }> {
  return apiRequest<{ events: PublicSeriesEvent[] }>(`/api/series/${encodeURIComponent(slug)}/events`, { requireAuth: false });
}

