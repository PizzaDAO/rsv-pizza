import {
  Home,
  Zap,
  Settings,
  Users,
  Pizza,
  Camera,
  Handshake,
  MapPin,
  Music,
  BarChart3,
  UserCog,
  Monitor,
  Ticket,
  Calculator,
  ListChecks,
  Package,
  Megaphone,
  FileImage,
  Printer,
  LayoutGrid,
} from 'lucide-react';
import { CoHost } from '../types';

export type TabId =
  | 'dashboard'
  | 'day-of'
  | 'details'
  | 'guests'
  | 'pizza'
  | 'photos'
  | 'partners'
  | 'venue'
  | 'music'
  | 'report'
  | 'staff'
  | 'displays'
  | 'raffle'
  | 'budget'
  | 'checklist'
  | 'gpp'
  | 'promo'
  | 'flyer'
  | 'print'
  | 'apps';

export interface HostTab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * All host dashboard tabs in display order.
 * Used by HostsManager for the permission picker UI.
 * Note: 'dashboard' is GPP-only, 'apps' is always shown.
 */
export const ALL_HOST_TABS: HostTab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'day-of', label: 'Day Of', icon: Zap },
  { id: 'details', label: 'Settings', icon: Settings },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'pizza', label: 'Pizza & Drinks', icon: Pizza },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'partners', label: 'Partners', icon: Handshake },
  { id: 'venue', label: 'Venue', icon: MapPin },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'report', label: 'Reports', icon: BarChart3 },
  { id: 'staff', label: 'Staffing', icon: UserCog },
  { id: 'displays', label: 'Displays', icon: Monitor },
  { id: 'raffle', label: 'Raffle', icon: Ticket },
  { id: 'budget', label: 'Budget', icon: Calculator },
  { id: 'checklist', label: 'Checklist', icon: ListChecks },
  { id: 'gpp', label: 'Party Kit', icon: Package },
  { id: 'promo', label: 'Promo', icon: Megaphone },
  { id: 'flyer', label: 'Flyer', icon: FileImage },
  { id: 'print', label: 'Print', icon: Printer },
  { id: 'apps', label: 'Apps', icon: LayoutGrid },
];

/**
 * Resolve a co-host's allowed tabs.
 * - Returns 'all' if no restriction (backward compatible: canEdit + no allowedTabs field).
 * - Returns string[] of allowed tab IDs otherwise (including empty array = no tabs).
 *
 * Key distinction:
 * - `undefined` (field absent) = legacy "all tabs" (backward compat)
 * - `[]` (empty array) = explicitly restricted to no tabs
 * - `['photos','music']` = restricted to those tabs
 */
export function getCoHostAllowedTabs(coHost: CoHost | null | undefined): 'all' | string[] {
  if (!coHost) return 'all';
  if (!Array.isArray(coHost.allowedTabs)) return 'all'; // undefined = all tabs (legacy)
  return coHost.allowedTabs;
}
