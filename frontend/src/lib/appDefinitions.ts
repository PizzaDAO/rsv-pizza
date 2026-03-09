import {
  Handshake,
  MapPin,
  Music,
  BarChart3,
  UserCog,
  Monitor,
  Shapes,
  Ticket,
  Calculator,
  ListChecks,
  Package,
  Megaphone,
} from 'lucide-react';

/**
 * App definitions for pinnable apps.
 * These are apps that have their own dedicated tab in the HostPage
 * and can be pinned to the tab bar for quick access.
 */
export interface PinnableApp {
  id: string;
  name: string;
  tab: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

export const PINNABLE_APPS: PinnableApp[] = [
  { id: 'sponsor-crm', name: 'Sponsors', tab: 'sponsors', icon: Handshake },
  { id: 'venue', name: 'Venue', tab: 'venue', icon: MapPin },
  { id: 'music-dj', name: 'Music', tab: 'music', icon: Music },
  { id: 'reports', name: 'Reports', tab: 'report', icon: BarChart3 },
  { id: 'staffing', name: 'Staffing', tab: 'staff', icon: UserCog },
  { id: 'displays', name: 'Displays', tab: 'displays', icon: Monitor },
  { id: 'rentals', name: 'Rentals', tab: 'rentals', icon: Shapes },
  { id: 'raffle', name: 'Raffle', tab: 'raffle', icon: Ticket },
  { id: 'budget', name: 'Budget', tab: 'budget', icon: Calculator },
  { id: 'checklist', name: 'Checklist', tab: 'checklist', icon: ListChecks },
  { id: 'party-kit', name: 'Party Kit', tab: 'gpp', icon: Package },
  { id: 'marketing-promo', name: 'Promo', tab: 'promo', icon: Megaphone },
];
