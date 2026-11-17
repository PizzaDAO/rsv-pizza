// Brand-admin API client (plans/wl-self-serve-brands.md PR 14). Every route is series-scoped under
// /api/brand-admin/:seriesId; the server 404s for a series the caller does not administer.
import { apiRequest } from './api';
import type { BrandAssetSlot, BrandAssetResult } from './seriesApi';
import type { ThemeTokens } from '../config/themeTokens';

export interface BrandAdminSeries {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  brandName: string | null;
  siteUrl: string | null;
  actorKind: 'series_admin' | 'super_admin';
  role: 'owner' | 'editor' | null;
  /** null for super-admins (they have no alert row). */
  alertsEnabled: boolean | null;
}

export interface BrandSettings {
  id: string;
  slug: string;
  name: string;
  siteUrl: string | null;
  requireApproval: boolean;
  createFlow: string | null;
  configVersion: number;
  brandName: string | null;
  displayName: string;
  tagline: string | null;
  metaDescription: string | null;
  supportEmail: string | null;
  description: string | null;
  nameTemplate: string | null;
  hideGuests: boolean;
  photosEnabled: boolean;
  photosPublic: boolean;
  eventDate: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  themeTokens: (ThemeTokens & { overrides?: Record<string, string> }) | null;
}

export type BrandAssets = Record<BrandAssetSlot, string | null>;

export interface BrandSettingsResponse {
  settings: BrandSettings;
  assets: BrandAssets;
}

export interface BrandSettingsSaveResult {
  changed: string[];
  settings: BrandSettings;
  /** Non-blocking notes, e.g. a low accent contrast. */
  warnings?: string[];
}

export interface BrandHistoryRow {
  id: string;
  action: 'settings.update' | 'revert' | 'asset.update' | 'asset.remove' | string;
  actorEmail: string;
  actorKind: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  createdAt: string;
}

export interface BrandChecklistItem {
  id: string;
  name: string;
  dueDate: string | null;
  linkTab: string | null;
  sortOrder: number;
  isAuto: boolean;
}

export interface BrandEvent {
  id: string;
  name: string;
  customUrl: string | null;
  inviteCode: string;
  city: string | null;
  country: string | null;
  date: string | null;
  venueName: string | null;
  address: string | null;
  underbossStatus: string;
  createdAt: string;
  user: { email: string | null; name: string | null } | null;
}

const base = (id: string) => `/api/brand-admin/${id}`;

export const fetchBrandAdminMe = () => apiRequest<{ series: BrandAdminSeries[] }>('/api/brand-admin/me');
export const fetchBrandSettings = (id: string) => apiRequest<BrandSettingsResponse>(`${base(id)}/settings`);
export const saveBrandSettings = (id: string, body: Record<string, unknown>) =>
  apiRequest<BrandSettingsSaveResult>(`${base(id)}/settings`, { method: 'PATCH', body });
export const fetchBrandHistory = (id: string) => apiRequest<{ history: BrandHistoryRow[] }>(`${base(id)}/audit`);
export const revertBrandSettings = (id: string, auditId: string) =>
  apiRequest<{ changed: string[]; settings: BrandSettings }>(`${base(id)}/revert`, { method: 'POST', body: { auditId } });

export const fetchBrandChecklist = (id: string) => apiRequest<{ items: BrandChecklistItem[] }>(`${base(id)}/checklist`);
export const addBrandChecklistItem = (id: string, data: { name: string; dueDate?: string | null; linkTab?: string | null }) =>
  apiRequest<{ item: BrandChecklistItem }>(`${base(id)}/checklist`, { method: 'POST', body: data });
export const updateBrandChecklistItem = (
  id: string,
  itemId: string,
  data: { name?: string; dueDate?: string | null; linkTab?: string | null; sortOrder?: number },
) => apiRequest<{ item: BrandChecklistItem; propagated: number }>(`${base(id)}/checklist/${itemId}`, { method: 'PATCH', body: data });
export const deleteBrandChecklistItem = (id: string, itemId: string) =>
  apiRequest<{ success: boolean }>(`${base(id)}/checklist/${itemId}`, { method: 'DELETE' });

export const fetchBrandEvents = (id: string, status: string) =>
  apiRequest<{ events: BrandEvent[] }>(`${base(id)}/events?status=${encodeURIComponent(status)}`);
export const setBrandEventStatus = (id: string, partyId: string, status: 'approved' | 'rejected' | 'hidden') =>
  apiRequest<{ party: { id: string; underbossStatus: string } }>(`${base(id)}/events/${partyId}/status`, { method: 'PATCH', body: { status } });

export const setBrandOwnAlerts = (id: string, alertsEnabled: boolean) =>
  apiRequest<{ admin: { alertsEnabled: boolean } }>(`${base(id)}/alerts`, { method: 'PATCH', body: { alertsEnabled } });

// ----- custom domain + sending domain (PR 16) -----

export type DomainStatus = 'requested' | 'dns_ok' | 'attached' | 'ready' | 'live';

export interface DnsRecord {
  purpose: 'ownership' | 'site' | 'vercel_verification' | 'email';
  type: string;
  name: string;
  value: string;
  priority?: number;
  status?: string;
  note?: string;
}

export interface DomainState {
  siteUrl: string | null;
  aliases: string[];
  domain: string | null;
  status: DomainStatus | null;
  checkedAt: string | null;
  records: DnsRecord[];
  checks: { txtOk: boolean; cnameOk: boolean; vercel?: { attached: boolean; verified: boolean; configured: boolean }; dnsError?: boolean } | null;
  /** Manual follow-ups returned by cutover / rollback. */
  steps: string[];
  changed?: boolean;
  projectMapped: boolean;
  configured: { vercel: boolean; resend: boolean };
}

export interface EmailDomainState {
  emailDomain: string | null;
  emailFromAddress: string | null;
  verified: boolean;
  verifiedAt: string | null;
  /** Resend's status: not_started | pending | verified | failed | temporary_failure. */
  status: string | null;
  records: DnsRecord[];
  changed?: boolean;
  error?: string;
  configured: { vercel: boolean; resend: boolean };
}

export const fetchBrandDomain = (id: string) => apiRequest<DomainState>(`${base(id)}/domain`);
export const requestBrandDomain = (id: string, domain: string) => apiRequest<DomainState>(`${base(id)}/domain`, { method: 'PUT', body: { domain } });
export const cancelBrandDomain = (id: string) => apiRequest<DomainState>(`${base(id)}/domain`, { method: 'DELETE' });
export const checkBrandDomain = (id: string) => apiRequest<DomainState>(`${base(id)}/domain/check`, { method: 'POST', body: {} });
export const attachBrandDomain = (id: string) => apiRequest<DomainState>(`${base(id)}/domain/attach`, { method: 'POST', body: {} });
export const cutoverBrandDomain = (id: string, redirectOld: boolean) =>
  apiRequest<DomainState>(`${base(id)}/domain/cutover`, { method: 'POST', body: { redirectOld } });
export const rollbackBrandDomain = (id: string) => apiRequest<DomainState>(`${base(id)}/domain/rollback`, { method: 'POST', body: {} });

export const fetchBrandEmailDomain = (id: string) => apiRequest<EmailDomainState>(`${base(id)}/email-domain`);
export const saveBrandEmailDomain = (id: string, emailDomain: string, emailFromAddress: string) =>
  apiRequest<EmailDomainState>(`${base(id)}/email-domain`, { method: 'PUT', body: { emailDomain, emailFromAddress } });
export const removeBrandEmailDomain = (id: string) => apiRequest<EmailDomainState>(`${base(id)}/email-domain`, { method: 'DELETE' });
export const checkBrandEmailDomain = (id: string) => apiRequest<EmailDomainState>(`${base(id)}/email-domain/check`, { method: 'POST', body: {} });

/** Shown on the PIZZADAO_DECIDED 409: PizzaDAO set this event's status and keeps a veto. */
export const PIZZADAO_VETO_MESSAGE =
  'PizzaDAO has set this event\'s status, so it can no longer be changed here. Contact PizzaDAO if you think it should change.';

type ApiErr = Error & { code?: string };

/** One clear, human message for any failure (rate limits, outages, vetoes), never a raw code. */
export function describeApiError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const err = e as ApiErr | undefined;
  if (!err) return fallback;
  if (err.code === 'PIZZADAO_DECIDED') return PIZZADAO_VETO_MESSAGE;
  if (err.code === 'RATE_LIMITED') return err.message && err.message !== 'Request failed' ? err.message : 'Too many changes. Please try again later.';
  if (err.code === 'NOT_CONFIGURED') return 'This is not set up on the server yet. Please contact PizzaDAO.';
  if (err.code === 'UNAVAILABLE') return 'This is temporarily unavailable. Please try again shortly.';
  if (err.code === 'TIMEOUT') return err.message;
  return err.message || fallback;
}

/** Image upload failures: 413 too big, 415 wrong type, 429 limits, 503 not available. */
export function describeUploadError(e: unknown): string {
  const err = e as ApiErr | undefined;
  const msg = err?.message || '';
  switch (err?.code) {
    case 'FILE_TOO_BIG':
      return /too big/i.test(msg) ? msg : 'That image is too big (10 MB max).';
    case 'BAD_FILE_TYPE':
    case 'BAD_FILE_SIZE':
      return /PNG, JPEG/.test(msg) ? msg : 'Please upload a PNG, JPEG or WebP image (SVG, GIF and AVIF are not accepted).';
    case 'RATE_LIMITED':
      return msg && msg !== 'Request failed' && !/upload failed/i.test(msg) ? msg : 'Too many uploads. Please try again later.';
    case 'UPLOADS_UNAVAILABLE':
      return 'Image uploads are not available yet. Please contact PizzaDAO.';
    case 'UNAVAILABLE':
      return 'Uploads are temporarily unavailable. Please try again shortly.';
    case 'UPLOAD_URL_FAILED':
    case 'STORE_FAILED':
    case 'FILE_MISSING':
      return msg || 'The upload failed. Please try again.';
    default:
      break;
  }
  if (/\b413\b|payload too large/i.test(msg)) return 'That image is too big (10 MB max).';
  if (/\b415\b|unsupported media/i.test(msg)) return 'Please upload a PNG, JPEG or WebP image.';
  if (/\b429\b/.test(msg)) return 'Too many uploads. Please try again later.';
  if (/\b503\b/.test(msg)) return 'Image uploads are not available right now. Please try again shortly.';
  return msg || 'The upload failed. Please try again.';
}

export const UPLOAD_MIME_OK = ['image/png', 'image/jpeg', 'image/webp'];
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Cheap client-side check before the upload starts (the server re-checks everything). */
export function precheckUpload(file: { type: string; size: number }): string | null {
  if (!UPLOAD_MIME_OK.includes(file.type)) return 'Please upload a PNG, JPEG or WebP image (SVG, GIF and AVIF are not accepted).';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > UPLOAD_MAX_BYTES) return 'That image is too big (10 MB max).';
  return null;
}

export type { BrandAssetSlot, BrandAssetResult };
