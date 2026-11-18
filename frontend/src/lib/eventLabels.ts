/**
 * blackolive-70521: host-chosen PUBLIC event tags (`parties.labels`).
 *
 * NOT `eventTags`/`event_tags`: that is the admin/system control channel. Labels are stable
 * lowercase slug keys from this curated list; display text is `event:labels.keys.<key>`.
 * Hand-mirrored from backend/src/lib/eventLabels.ts; both are tested against
 * scripts/event-labels.json. Keys are final once shipped, so add rather than rename.
 */
import {
  Accessibility,
  Baby,
  Coffee,
  Code,
  Disc3,
  Gamepad2,
  GraduationCap,
  Handshake,
  Heart,
  Leaf,
  Mic,
  Music,
  Palette,
  Ticket,
  Trees,
  UsersRound,
  Venus,
  Wine,
  WheatOff,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export const EVENT_LABEL_KEYS = [
  'family-friendly',
  'kid-friendly',
  'all-ages',
  '21-plus',
  'outdoor',
  'live-music',
  'dj',
  'workshop',
  'talks',
  'networking',
  'hackathon',
  'meetup',
  'students',
  'women-in-web3',
  'vegan-options',
  'gluten-free-options',
  'free',
  'wheelchair-accessible',
  'art',
  'gaming',
] as const;

export type EventLabelKey = (typeof EVENT_LABEL_KEYS)[number];

export const MAX_EVENT_LABELS = 5;

export const EVENT_LABEL_ICONS: Record<EventLabelKey, LucideIcon> = {
  'family-friendly': Heart,
  'kid-friendly': Baby,
  'all-ages': UsersRound,
  '21-plus': Wine,
  outdoor: Trees,
  'live-music': Music,
  dj: Disc3,
  workshop: Wrench,
  talks: Mic,
  networking: Handshake,
  hackathon: Code,
  meetup: Coffee,
  students: GraduationCap,
  'women-in-web3': Venus,
  'vegan-options': Leaf,
  'gluten-free-options': WheatOff,
  free: Ticket,
  'wheelchair-accessible': Accessibility,
  art: Palette,
  gaming: Gamepad2,
};

const ALLOWED = new Set<string>(EVENT_LABEL_KEYS);

export function isEventLabelKey(v: unknown): v is EventLabelKey {
  return typeof v === 'string' && ALLOWED.has(v);
}

/**
 * Keep only known keys, deduped, in canonical (allowlist) order. Unknown keys are dropped so a raw
 * slug is never rendered (e.g. a key added server-side before this client knows about it).
 */
export function knownLabels(input: unknown): EventLabelKey[] {
  if (!Array.isArray(input)) return [];
  const picked = new Set(input.filter(isEventLabelKey));
  return EVENT_LABEL_KEYS.filter((k) => picked.has(k));
}
