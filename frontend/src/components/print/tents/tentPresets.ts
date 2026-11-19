import { brandUrl } from '../../../config/brand';
import { flyerEventUrl } from '../../generative/flyerQr';

export type TentPreset = 'rsvp' | 'wifi' | 'custom';
/** 'wifi' is encoded by wifiQr.ts (the password never goes through TentContent). */
export type TentQrTarget = 'none' | 'event' | 'booth' | 'custom' | 'wifi';

export interface TentContent {
  headline: string;
  body: string;
  showEventName: boolean;
  showDate: boolean;
  qr: TentQrTarget;
  customUrl: string;
}

export const HEADLINE_MAX = 40;
export const BODY_MAX = 200;

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

type PartyLike = { customUrl?: string | null; inviteCode?: string | null };

/** URL the tent QR encodes, or null for "none" / an invalid custom link. */
export function tentQrUrl(qr: TentQrTarget, party: PartyLike, customUrl: string): string | null {
  switch (qr) {
    case 'event':
      return flyerEventUrl(party);
    case 'booth': {
      const slug = party.customUrl || party.inviteCode;
      return slug ? brandUrl(`${slug}/booth`) : null;
    }
    case 'custom':
      return isHttpUrl(customUrl) ? customUrl.trim() : null;
    default:
      return null;
  }
}

/** Short human-readable caption under the QR code. */
export function qrCaption(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export interface PresetStrings {
  rsvpHeadline: string;
  rsvpBody: string;
  wifiHeadline: string;
}

export function presetContent(preset: TentPreset, party: { wifiInfo?: string | null }, s: PresetStrings): TentContent {
  const base: TentContent = { headline: '', body: '', showEventName: true, showDate: true, qr: 'none', customUrl: '' };
  if (preset === 'rsvp') return { ...base, headline: s.rsvpHeadline, body: s.rsvpBody, qr: 'event' };
  if (preset === 'wifi') return { ...base, headline: s.wifiHeadline, body: (party.wifiInfo ?? '').slice(0, BODY_MAX), showDate: false };
  return base;
}
