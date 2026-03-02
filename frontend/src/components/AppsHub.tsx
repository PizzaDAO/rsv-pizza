import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Beer,
  Store,
  Bot,
  Coins,
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
  ListOrdered,
  ListChecks,
  Printer,
  UtensilsCrossed,
  FileImage,
  CreditCard,
  ShoppingBag,
  Gift,
  TicketCheck,
  ExternalLink,
  Pin,
  PinOff,
} from 'lucide-react';
import { updateParty } from '../lib/supabase';
import { usePizza } from '../contexts/PizzaContext';
import { PINNABLE_APPS } from '../lib/appDefinitions';

type AppStatus = 'live' | 'preview' | 'coming-soon';

interface AppItem {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  status: AppStatus;
  tab?: string;
  externalPath?: string;
  previewUrl?: string;
}

const apps: AppItem[] = [
  // Live features
  {
    id: 'beverages',
    name: 'Beverages',
    description: 'Track beverage preferences and recommendations',
    icon: Beer,
    status: 'live',
    tab: 'pizza',
  },
  {
    id: 'pizzeria-selection',
    name: 'Pizzeria Selection',
    description: 'Find and select nearby pizzerias',
    icon: Store,
    status: 'live',
    tab: 'pizza',
  },
  {
    id: 'ai-phone-ordering',
    name: 'AI Phone Ordering',
    description: 'Call pizzerias with AI to place orders',
    icon: Bot,
    status: 'live',
    tab: 'pizza',
  },
  {
    id: 'nft-minting',
    name: 'NFT Minting',
    description: 'Attendance NFTs on Base and Monad',
    icon: Coins,
    status: 'live',
    tab: 'details',
  },

  // Previously preview, now live
  {
    id: 'sponsor-crm',
    name: 'Sponsor CRM',
    description: 'Manage event sponsors and partnerships',
    icon: Handshake,
    status: 'live',
    tab: 'sponsors',
  },
  {
    id: 'venue',
    name: 'Venue',
    description: 'Venue details and floor plans',
    icon: MapPin,
    status: 'live',
    tab: 'venue',
  },
  {
    id: 'music-dj',
    name: 'Music / DJ',
    description: 'Music playlist and DJ coordination',
    icon: Music,
    status: 'live',
    tab: 'music',
  },
  {
    id: 'reports',
    name: 'Reports',
    description: 'Event analytics and reports',
    icon: BarChart3,
    status: 'live',
    tab: 'report',
  },
  {
    id: 'staffing',
    name: 'Staffing',
    description: 'Volunteer and staff management',
    icon: UserCog,
    status: 'live',
    tab: 'staff',
  },
  {
    id: 'displays',
    name: 'Displays',
    description: 'Event display screens and signage',
    icon: Monitor,
    status: 'live',
    tab: 'displays',
  },
  {
    id: 'raffle',
    name: 'Raffle',
    description: 'Event raffle and prize drawings',
    icon: Ticket,
    status: 'live',
    tab: 'raffle',
  },
  {
    id: 'budget',
    name: 'Budget',
    description: 'Event budget tracking and planning',
    icon: Calculator,
    status: 'live',
    tab: 'budget',
  },
  {
    id: 'party-kit',
    name: 'Party Kit',
    description: 'Event supplies and party kit management',
    icon: Package,
    status: 'live',
    tab: 'gpp',
  },
  {
    id: 'marketing-promo',
    name: 'Marketing / Promo',
    description: 'Promotional materials and marketing tools',
    icon: Megaphone,
    status: 'live',
    tab: 'promo',
  },
  {
    id: 'waitlist',
    name: 'Waitlist',
    description: 'Waitlist management for sold-out events',
    icon: ListOrdered,
    status: 'live',
    tab: 'guests',
  },

  // Coming Soon features
  {
    id: 'checklist',
    name: 'Checklist',
    description: 'Event planning checklist',
    icon: ListChecks,
    status: 'coming-soon',
  },
  {
    id: 'print-nametags',
    name: 'Print / Nametags',
    description: 'Print nametags and table tents',
    icon: Printer,
    status: 'coming-soon',
  },
  {
    id: 'potluck',
    name: 'Potluck',
    description: 'Coordinate potluck dishes',
    icon: UtensilsCrossed,
    status: 'coming-soon',
  },
  {
    id: 'flyer',
    name: 'Flyer',
    description: 'Generate event flyers',
    icon: FileImage,
    status: 'coming-soon',
  },
  {
    id: 'payment-portal',
    name: 'Payment Portal',
    description: 'Host reimbursements and payments',
    icon: CreditCard,
    status: 'coming-soon',
  },
  {
    id: 'merch',
    name: 'Merch',
    description: 'Sell event merchandise',
    icon: ShoppingBag,
    status: 'coming-soon',
  },
  {
    id: 'secret-santa',
    name: 'Secret Santa',
    description: 'Gift exchange coordination',
    icon: Gift,
    status: 'coming-soon',
  },
  {
    id: 'ticketing',
    name: 'Ticketing',
    description: 'Ticketed event management',
    icon: TicketCheck,
    status: 'coming-soon',
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
    'coming-soon': 'bg-white/10 text-white/40',
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
}: {
  app: AppItem;
  inviteCode: string;
  navigate: ReturnType<typeof useNavigate>;
  isPinned: boolean;
  onTogglePin?: (appId: string, pin: boolean) => void;
}) {
  const isClickable = app.status !== 'coming-soon';
  const canPin = isPinnable(app.id) && app.status === 'live';

  const iconBg = {
    live: 'bg-[#39d98a]/15',
    preview: 'bg-[#5c7cfa]/15',
    'coming-soon': 'bg-white/5',
  };

  const iconColor = {
    live: 'text-[#39d98a]',
    preview: 'text-[#5c7cfa]',
    'coming-soon': 'text-white/30',
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
      className={`card p-5 text-left transition-colors w-full relative group ${
        isClickable
          ? 'hover:bg-white/5 cursor-pointer'
          : 'cursor-not-allowed opacity-50'
      }`}
    >
      {canPin && (
        <div
          onClick={handlePinClick}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all cursor-pointer ${
            isPinned
              ? 'bg-[#ff393a]/20 text-[#ff393a] opacity-100'
              : 'bg-white/5 text-white/30 opacity-0 group-hover:opacity-100 hover:text-white/60 hover:bg-white/10'
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
            <span className="text-sm font-medium text-white truncate">{app.name}</span>
            {isPinned && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#ff393a]/15 text-[#ff393a]">
                Pinned
              </span>
            )}
            {app.status === 'preview' && (
              <ExternalLink size={12} className="text-[#5c7cfa] flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-white/40 leading-relaxed">{app.description}</p>
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
}: {
  title: string;
  apps: AppItem[];
  inviteCode: string;
  navigate: ReturnType<typeof useNavigate>;
  pinnedApps: string[];
  onTogglePin: (appId: string, pin: boolean) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-3">
        {title} <span className="text-white/30">({sectionApps.length})</span>
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
  const { loadParty } = usePizza();
  const [pinnedApps, setPinnedApps] = useState<string[]>(initialPinnedApps);

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

  const liveApps = apps.filter((a) => a.status === 'live');
  const previewApps = apps.filter((a) => a.status === 'preview');
  const comingSoonApps = apps.filter((a) => a.status === 'coming-soon');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-white/40 mt-1">
            Click an app to open it. Hover and click the pin icon to add it to your tab bar.
          </p>
        </div>
      </div>
      {liveApps.length > 0 && (
        <AppSection
          title="Live"
          apps={liveApps}
          inviteCode={inviteCode}
          navigate={navigate}
          pinnedApps={pinnedApps}
          onTogglePin={handleTogglePin}
        />
      )}
      {previewApps.length > 0 && (
        <AppSection
          title="Preview"
          apps={previewApps}
          inviteCode={inviteCode}
          navigate={navigate}
          pinnedApps={pinnedApps}
          onTogglePin={handleTogglePin}
        />
      )}
      {comingSoonApps.length > 0 && (
        <AppSection
          title="Coming Soon"
          apps={comingSoonApps}
          inviteCode={inviteCode}
          navigate={navigate}
          pinnedApps={pinnedApps}
          onTogglePin={handleTogglePin}
        />
      )}
    </div>
  );
}
