import {
  PartyPopper, Package, Users, MapPin, DollarSign, Handshake, ClipboardCheck, Megaphone, Rocket,
  ShieldCheck, Pizza, Camera, FileImage, Printer, Zap, Monitor, Settings, LucideIcon,
} from 'lucide-react';
import type { ChecklistItem } from '../../types';
import type { ChecklistVariant } from './checklistActions';

type IconItem = Pick<ChecklistItem, 'name' | 'autoRule' | 'linkTab'>;

// Map known GPP item names to Lucide icons.
const ICON_MAP: Record<string, LucideIcon> = {
  'Create Event': PartyPopper,
  'Request Party Kit': Package,
  'Build a Team': Users,
  'Find a Venue': MapPin,
  'Set Up Budget': DollarSign,
  'Find Partners': Handshake,
  'Select Pizzeria': MapPin,
  'Prepare for the Party': ClipboardCheck,
  'Post to Socials': Megaphone,
  'Post about the party on socials': Megaphone,
  'Throw the Party': Rocket,
  'Get reviewed for funding': ShieldCheck,
  'Estimated Attendance': Users,
};

// Fallback icons for items not in ICON_MAP (brand-series lists), by meaning.
const RULE_ICONS: Record<string, LucideIcon> = {
  event_created: PartyPopper,
  underboss_reviewed: ShieldCheck,
  team_built: Users,
  venue_added: MapPin,
  pizzerias_selected: Pizza,
  attendance_estimated: Users,
};
const TAB_ICONS: Record<string, LucideIcon> = {
  partners: Handshake,
  'social-post': Megaphone,
  promo: Megaphone,
  photos: Camera,
  flyer: FileImage,
  print: Printer,
  'party-guide': Zap,
  displays: Monitor,
  guests: Users,
  pizza: Pizza,
  details: Settings,
};

// Display-label overrides — the DB `name` stays the stable key (matched for
// the icon and the `attendance_estimated` auto-rule); only the rendered text differs.
const LABEL_OVERRIDES: Record<string, string> = {
  'Estimated Attendance': 'Submit Estimated Attendance',
};

/**
 * Row icon. GPP keeps the original name map with a ClipboardCheck fallback;
 * brand-series items also fall back by auto rule / link so they get meaningful
 * icons.
 */
export function checklistIcon(item: IconItem, variant: ChecklistVariant): LucideIcon {
  if (variant === 'gpp') return ICON_MAP[item.name] ?? ClipboardCheck;
  return ICON_MAP[item.name]
    ?? (item.autoRule ? RULE_ICONS[item.autoRule] : undefined)
    ?? (item.linkTab ? TAB_ICONS[item.linkTab] : undefined)
    ?? ClipboardCheck;
}

export function checklistLabel(item: Pick<ChecklistItem, 'name'>): string {
  return LABEL_OVERRIDES[item.name] ?? item.name;
}
