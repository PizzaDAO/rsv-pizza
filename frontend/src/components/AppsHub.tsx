import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store,
  Handshake,
  MapPin,
  Music,
  BarChart3,
  UserCog,
  Monitor,
  Ticket,
  Calculator,
  Package,
  Megaphone,
  Printer,
  FileImage,
  Receipt,
  ShoppingBag,
  ExternalLink,
  Pin,
  PinOff,
} from 'lucide-react';
import { updateParty } from '../lib/supabase';
import { usePizza } from '../contexts/PizzaContext';
import { PINNABLE_APPS } from '../lib/appDefinitions';

type AppStatus = 'live' | 'preview' | 'coming-soon';
type AppCategory = 'planning' | 'promotion' | 'day-of' | 'after-party';

const CATEGORY_ORDER: { key: AppCategory; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'promotion', label: 'Lead-up' },
  { key: 'day-of', label: 'Day-of' },
  { key: 'after-party', label: 'After Party' },
];

interface AppItem {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  status: AppStatus;
  category: AppCategory;
  tab?: string;
  externalPath?: string;
  previewUrl?: string;
}

const apps: AppItem[] = [
  // Planning
  {
    id: 'party-kit',
    name: 'Party Kit',
    description: 'Event supplies and party kit management',
    icon: Package,
    status: 'live',
    category: 'planning',
    tab: 'gpp',
  },
  {
    id: 'venue',
    name: 'Venue',
    description: 'Venue details and floor plans',
    icon: MapPin,
    status: 'live',
    category: 'planning',
    tab: 'venue',
  },
  {
    id: 'sponsor-crm',
    name: 'Partners',
    description: 'Manage event partners and sponsorships',
    icon: Handshake,
    status: 'live',
    category: 'planning',
    tab: 'partners',
  },
  {
    id: 'pizzeria-selection',
    name: 'Pizza & Drinks',
    description: 'Find and select nearby pizzerias for food and drinks',
    icon: Store,
    status: 'live',
    category: 'planning',
    tab: 'pizza',
  },
  {
    id: 'budget',
    name: 'Budget',
    description: 'Event budget tracking and planning',
    icon: Calculator,
    status: 'live',
    category: 'planning',
    tab: 'budget',
  },
  {
    id: 'staffing',
    name: 'Staffing',
    description: 'Volunteer and staff management',
    icon: UserCog,
    status: 'live',
    category: 'planning',
    tab: 'staff',
  },

  // Lead-up
  {
    id: 'flyer',
    name: 'Flyer',
    description: 'Generate event flyers',
    icon: FileImage,
    status: 'live',
    category: 'promotion',
    tab: 'flyer',
  },
  {
    id: 'marketing-promo',
    name: 'Promo',
    description: 'Promotional materials and marketing tools',
    icon: Megaphone,
    status: 'live',
    category: 'promotion',
    tab: 'promo',
  },
  {
    id: 'print-nametags',
    name: 'Print / Nametags',
    description: 'Stickers, flyers, name tags & more',
    icon: Printer,
    status: 'live',
    category: 'promotion',
    tab: 'print',
  },

  // Day-of
  {
    id: 'music-dj',
    name: 'Music / DJ',
    description: 'Music playlist and DJ coordination',
    icon: Music,
    status: 'live',
    category: 'day-of',
    tab: 'music',
  },
  {
    id: 'displays',
    name: 'Displays',
    description: 'Event display screens and signage',
    icon: Monitor,
    status: 'live',
    category: 'day-of',
    tab: 'displays',
  },
  {
    id: 'raffle',
    name: 'Raffle',
    description: 'Event raffle and prize drawings',
    icon: Ticket,
    status: 'live',
    category: 'day-of',
    tab: 'raffle',
  },

  // After Party
  {
    id: 'reports',
    name: 'Reports',
    description: 'Event analytics and reports',
    icon: BarChart3,
    status: 'live',
    category: 'after-party',
    tab: 'report',
  },
  {
    id: 'payments',
    name: 'Payments',
    description: 'Submit receipts for host payment',
    icon: Receipt,
    status: 'live',
    category: 'after-party',
    tab: 'payments',
  },
  {
    id: 'merch',
    name: 'Merch',
    description: 'Sell event merchandise',
    icon: ShoppingBag,
    status: 'coming-soon',
    category: 'after-party',
  },
];

// Check if an app is pinnable (has its own dedicated tab, not a core tab)
function isPinnable(appId: string): boolean {
  return PINNABLE_APPS.some(a => a.id === appId);
}

function StatusBadge({ status }: { status: AppStatus }) {
  const styles = {
    live: 'bg-[#39d98a]/20 text-[#39d98a]',
    preview: 'bg-[#5c7cfa]/20 text-[#5c7cfa]',
    'coming-soon': 'bg-theme-surface-hover text-theme-text-muted',
  };

  const labels = {
    live: 'Live',
    preview: 'Preview',
    'coming-soon': 'Coming Soon',
  };

  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function AppCard({
  app,
  inviteCode,
  navigate,
  isPinned,
  onTogglePin,
  isGppEvent,
}: {
  app: AppItem;
  inviteCode: string;
  navigate: ReturnType<typeof useNavigate>;
  isPinned: boolean;
  onTogglePin?: (appId: string, pin: boolean) => void;
  isGppEvent: boolean;
}) {
  const isClickable = app.status !== 'coming-soon';
  const canPin = isPinnable(app.id) && app.status === 'live';

  // GPP events hide drinks UI — relabel the pizza tile so the tile copy doesn't reference drinks.
  const displayName = isGppEvent && app.id === 'pizzeria-selection' ? 'Pizza' : app.name;
  const displayDescription = isGppEvent && app.id === 'pizzeria-selection'
    ? 'Find and select nearby pizzerias'
    : app.description;

  const iconBg = {
    live: 'bg-[#39d98a]/15',
    preview: 'bg-[#5c7cfa]/15',
    'coming-soon': 'bg-theme-surface',
  };

  const iconColor = {
    live: 'text-[#39d98a]',
    preview: 'text-[#5c7cfa]',
    'coming-soon': 'text-theme-text-faint',
  };

  const Icon = app.icon;

  const handleClick = () => {
    if (app.status === 'coming-soon') return;

    if (app.status === 'live' && app.tab) {
      if (app.tab === 'details') {
        navigate(`/host/${inviteCode}`);
      } else {
        navigate(`/host/${inviteCode}/${app.tab}`);
      }
    } else if (app.status === 'live' && app.externalPath) {
      navigate(app.externalPath);
    } else if (app.status === 'preview' && app.previewUrl) {
      window.open(`https://${app.previewUrl}`, '_blank');
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onTogglePin) {
      onTogglePin(app.id, !isPinned);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!isClickable}
      className={`card p-5 text-left transition-all w-full relative group ${
        isClickable
          ? 'hover:-translate-y-1 hover:shadow-lg cursor-pointer'
          : 'cursor-not-allowed opacity-50'
      }`}
    >
      {canPin && (
        <div
          onClick={handlePinClick}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all cursor-pointer ${
            isPinned
              ? 'bg-[#ff393a]/20 text-[#ff393a] opacity-100'
              : 'bg-theme-surface text-theme-text-faint opacity-0 group-hover:opacity-100 hover:text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
          title={isPinned ? 'Unpin from tab bar' : 'Pin to tab bar'}
        >
          {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </div>
      )}
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg[app.status]}`}
        >
          <Icon size={20} className={iconColor[app.status]} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-theme-text truncate">{displayName}</span>
            {isPinned && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#ff393a]/15 text-[#ff393a]">
                Pinned
              </span>
            )}
            {app.status === 'preview' && (
              <ExternalLink size={12} className="text-[#5c7cfa] flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-theme-text-muted leading-relaxed">{displayDescription}</p>
          <div className="mt-2">
            <StatusBadge status={app.status} />
          </div>
        </div>
      </div>
    </button>
  );
}

function AppSection({
  title,
  apps: sectionApps,
  inviteCode,
  navigate,
  pinnedApps,
  onTogglePin,
  isGppEvent,
}: {
  title: string;
  apps: AppItem[];
  inviteCode: string;
  navigate: ReturnType<typeof useNavigate>;
  pinnedApps: string[];
  onTogglePin: (appId: string, pin: boolean) => void;
  isGppEvent: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider mb-3">
        {title} <span className="text-theme-text-faint">({sectionApps.length})</span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sectionApps.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            inviteCode={inviteCode}
            navigate={navigate}
            isPinned={pinnedApps.includes(app.id)}
            onTogglePin={onTogglePin}
            isGppEvent={isGppEvent}
          />
        ))}
      </div>
    </div>
  );
}

export function AppsHub({
  inviteCode,
  pinnedApps: initialPinnedApps,
  partyId,
}: {
  inviteCode: string;
  pinnedApps: string[];
  partyId: string;
}) {
  const navigate = useNavigate();
  const { loadParty, party } = usePizza();
  const [pinnedApps, setPinnedApps] = useState<string[]>(initialPinnedApps);
  const isGppEvent = party?.eventType === 'gpp';

  // marzano-49102: Payments tile is unconditionally live for all signed-in
  // party hosts/cohosts. The downstream cap-display gate (hide $ unless the
  // 'go' event_tag is set) lives in HostPage where Party props are passed
  // into PayoutsTab.
  const visibleApps = apps;

  const handleTogglePin = async (appId: string, pin: boolean) => {
    // Optimistic update
    const previousPinned = pinnedApps;
    const newPinned = pin
      ? [...pinnedApps, appId]
      : pinnedApps.filter(id => id !== appId);
    setPinnedApps(newPinned);

    const success = await updateParty(partyId, { pinned_apps: newPinned });
    if (!success) {
      // Revert on failure
      setPinnedApps(previousPinned);
    } else {
      // Reload party to sync the tab bar in HostPage
      loadParty(inviteCode);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-theme-text-muted mt-1">
            Click an app to open it. Hover and click the pin icon to add it to your tab bar.
          </p>
        </div>
      </div>
      {CATEGORY_ORDER.map(({ key, label }) => {
        const categoryApps = visibleApps.filter((a) => a.category === key);
        if (categoryApps.length === 0) return null;
        return (
          <AppSection
            key={key}
            title={label}
            apps={categoryApps}
            inviteCode={inviteCode}
            navigate={navigate}
            pinnedApps={pinnedApps}
            onTogglePin={handleTogglePin}
            isGppEvent={isGppEvent}
          />
        );
      })}
    </div>
  );
}
