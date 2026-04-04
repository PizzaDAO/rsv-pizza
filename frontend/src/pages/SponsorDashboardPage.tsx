import React, { useEffect, useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { IconInput } from '../components/IconInput';
import { SponsorChecklist } from '../components/sponsor-dashboard/SponsorChecklist';
import { EventInfoCard } from '../components/sponsor-dashboard/EventInfoCard';
import { BudgetSummary } from '../components/sponsor-dashboard/BudgetSummary';
import { RsvpCounter } from '../components/sponsor-dashboard/RsvpCounter';
import { useAuth } from '../contexts/AuthContext';
import { fetchSponsorMe, fetchSponsorEvents, toggleSponsorChecklistItem } from '../lib/api';
import {
  Loader2, Shield, Tag, ExternalLink, ClipboardList, DollarSign, Users,
  Search, ThumbsUp, ThumbsDown, BarChart3,
} from 'lucide-react';
import type { SponsorDashboardEvent, SponsorMeResponse, SponsorDashboardData, CoHost } from '../types';
import { GPP_REGIONS } from '../types';

// ============================================
// Progress filter constants & FilterPill
// ============================================

const PROGRESS_FILTER_KEYS: { key: string; label: string }[] = [
  { key: 'hasPartyKit', label: 'Kit' },
  { key: 'hasCoHosts', label: 'Team' },
  { key: 'hasVenue', label: 'Venue' },
  { key: 'hasBudget', label: 'Budget' },
  { key: 'hasSponsors', label: 'Partners' },
  { key: 'hasSocialPosts', label: 'Social' },
  { key: 'hasThrown', label: 'Thrown' },
];

function FilterPill({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: 'neutral' | 'include' | 'exclude';
  onToggle: (newState: 'neutral' | 'include' | 'exclude') => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
        state === 'include'
          ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
          : state === 'exclude'
            ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
            : 'bg-white/[0.03] border-white/10'
      }`}
    >
      <button
        onClick={() => onToggle(state === 'include' ? 'neutral' : 'include')}
        className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
        title={`Must have ${label}`}
      >
        <ThumbsUp
          size={12}
          className={`transition-all ${state === 'include' ? 'text-[#39d98a]' : 'text-white/30'}`}
        />
        <span className="text-white text-xs">{label}</span>
      </button>
      <button
        onClick={() => onToggle(state === 'exclude' ? 'neutral' : 'exclude')}
        className="p-0.5 hover:opacity-70 transition-opacity"
        title={`Must NOT have ${label}`}
      >
        <ThumbsDown
          size={12}
          className={`transition-all ${state === 'exclude' ? 'text-[#ff393a]' : 'text-white/30'}`}
        />
      </button>
    </div>
  );
}

export function SponsorDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<SponsorMeResponse | null>(null);
  const [dashboardData, setDashboardData] = useState<SponsorDashboardData | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');

  // Three-state progress filters
  const [progressIncludes, setProgressIncludes] = useState<string[]>([]);
  const [progressExcludes, setProgressExcludes] = useState<string[]>([]);

  // Region filter (simple dropdown like underboss)
  const [regionFilter, setRegionFilter] = useState<string>('all');

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }

    async function loadDashboard() {
      try {
        const me = await fetchSponsorMe();
        setMeData(me);

        if (!me.isSponsor) {
          setLoading(false);
          return;
        }

        // If admin, load all events first to get available tags
        const tag = me.isAdmin ? selectedTag : me.sponsor?.tag;
        const data = await fetchSponsorEvents(tag);
        setDashboardData(data);

        // For admins, extract unique tags from events to build a tag picker
        if (me.isAdmin && !selectedTag) {
          const tags = new Set<string>();
          data.events.forEach(e => {
            // eventTags are on the event but not in the response — use the dashboard tag
            if (data.tag) tags.add(data.tag);
          });
          // Also fetch all sponsor users to get all tags
          try {
            const { fetchSponsorUsers } = await import('../lib/api');
            const sponsorUsers = await fetchSponsorUsers();
            sponsorUsers.forEach(su => tags.add(su.tag));
          } catch { /* admin-only, ok to fail */ }
          setAvailableTags(Array.from(tags).sort());
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load sponsor dashboard');
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user, authLoading, selectedTag]);

  async function handleToggleChecklist(eventId: string, itemId: string) {
    if (!dashboardData) return;

    // Optimistic update
    setDashboardData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map(event => {
          if (event.id !== eventId) return event;
          return {
            ...event,
            checklist: event.checklist.map(item => {
              if (item.id !== itemId) return item;
              return {
                ...item,
                completed: !item.completed,
                completedAt: !item.completed ? new Date().toISOString() : null,
              };
            }),
          };
        }),
      };
    });

    try {
      await toggleSponsorChecklistItem(itemId);
    } catch {
      // Revert on failure
      const data = await fetchSponsorEvents();
      setDashboardData(data);
    }
  }

  // Derived data (must be above early returns to preserve hook order)
  const sponsor = dashboardData?.sponsor;
  const allEvents = dashboardData?.events || [];

  function getFilterState(key: string): 'neutral' | 'include' | 'exclude' {
    if (progressIncludes.includes(key)) return 'include';
    if (progressExcludes.includes(key)) return 'exclude';
    return 'neutral';
  }

  function setFilterState(key: string, newState: 'neutral' | 'include' | 'exclude') {
    setProgressIncludes((prev) => prev.filter((k) => k !== key));
    setProgressExcludes((prev) => prev.filter((k) => k !== key));
    if (newState === 'include') {
      setProgressIncludes((prev) => [...prev, key]);
    } else if (newState === 'exclude') {
      setProgressExcludes((prev) => [...prev, key]);
    }
  }

  const events = useMemo(() => {
    let filtered = allEvents;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.hostName && e.hostName.toLowerCase().includes(q)) ||
        (e.venueName && e.venueName.toLowerCase().includes(q)) ||
        (e.address && e.address.toLowerCase().includes(q))
      );
    }

    // Progress includes (AND: event must have ALL included progress items)
    if (progressIncludes.length > 0) {
      filtered = filtered.filter(e => {
        if (!e.progress) return false;
        return progressIncludes.every(key => e.progress![key as keyof typeof e.progress]);
      });
    }

    // Progress excludes (AND: event must NOT have ANY excluded progress items)
    if (progressExcludes.length > 0) {
      filtered = filtered.filter(e => {
        if (!e.progress) return true; // if no progress data, don't exclude
        return progressExcludes.every(key => !e.progress![key as keyof typeof e.progress]);
      });
    }

    // Region filter
    if (regionFilter !== 'all') {
      filtered = filtered.filter(e => e.region === regionFilter);
    }

    // Sort by date descending (default, no user-selectable sort)
    const sorted = [...filtered].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return sorted;
  }, [allEvents, searchQuery, progressIncludes, progressExcludes, regionFilter]);

  const hasActiveFilters = searchQuery.trim() !== '' || progressIncludes.length > 0 || progressExcludes.length > 0 || regionFilter !== 'all';

  function clearAllFilters() {
    setSearchQuery('');
    setProgressIncludes([]);
    setProgressExcludes([]);
    setRegionFilter('all');
  }

  // Loading state
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-white/40" />
        </div>
        <Footer />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Sponsor Dashboard</h1>
          <p className="text-white/50 text-center max-w-md mb-6">
            Log in to access your sponsor dashboard.
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-6 py-2 bg-[#ff393a] text-white rounded-xl text-sm font-medium hover:bg-[#e62e2f] transition-colors"
          >
            Log In
          </button>
        </div>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
          <p className="text-white/50 text-center max-w-md">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Not a sponsor
  if (!meData?.isSponsor) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/50 text-center max-w-md">
            You do not have sponsor access. Contact an admin to get set up.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Helmet>
        <title>Sponsor Dashboard | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#ff393a]/20 flex items-center justify-center">
              <Tag size={20} className="text-[#ff393a]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {dashboardData?.isAdmin ? 'Sponsor Dashboard' : `${sponsor?.name || 'Sponsor'} Dashboard`}
              </h1>
              <p className="text-sm text-white/50">
                Showing {events.length}{events.length !== allEvents.length ? ` of ${allEvents.length}` : ''} event{events.length !== 1 ? 's' : ''}{dashboardData?.tag ? ` tagged "${dashboardData.tag}"` : ''}
              </p>
            </div>
          </div>

          {/* Admin tag filter */}
          {dashboardData?.isAdmin && availableTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedTag(undefined)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  !selectedTag
                    ? 'border-[#ff393a] text-white bg-[#ff393a]/20'
                    : 'border-white/10 text-white/50 hover:text-white/70'
                }`}
              >
                All tags
              </button>
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    selectedTag === tag
                      ? 'border-[#ff393a] text-white bg-[#ff393a]/20'
                      : 'border-white/10 text-white/50 hover:text-white/70'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        {allEvents.length > 0 && (
          <div className="mb-6 space-y-3">
            {/* Search */}
            <div className="max-w-sm">
              <IconInput
                icon={Search}
                type="search"
                placeholder="Search events, hosts, venues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              />
            </div>

            {/* Progress filter pills + Region dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              {PROGRESS_FILTER_KEYS.map(({ key, label }) => (
                <FilterPill
                  key={key}
                  label={label}
                  state={getFilterState(key)}
                  onToggle={(newState) => setFilterState(key, newState)}
                />
              ))}

              {/* Region filter dropdown */}
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/70 focus:outline-none focus:border-white/20"
              >
                <option value="all">Region: All</option>
                {GPP_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Events grid */}
        {events.length === 0 ? (
          <div className="text-center py-16">
            <Tag size={48} className="text-white/10 mx-auto mb-4" />
            {hasActiveFilters ? (
              <>
                <p className="text-white/40 mb-3">No events match your filters.</p>
                <button
                  onClick={clearAllFilters}
                  className="px-4 py-2 text-sm text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-colors"
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <p className="text-white/40">No events found with your sponsor tag.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6">
            {events.map(event => (
              <EventCard
                key={event.id}
                event={event}
                onToggleChecklist={(itemId) => handleToggleChecklist(event.id, itemId)}
              />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

// ============================================
// Event Card component
// ============================================

interface EventCardProps {
  event: SponsorDashboardEvent;
  onToggleChecklist: (itemId: string) => void;
}

function EventCard({ event, onToggleChecklist }: EventCardProps) {
  // Filter co-hosts to show only visible ones
  const visibleCoHosts = event.coHosts.filter((h: CoHost) => h.showOnEvent !== false);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col md:flex-row">
      {/* Flyer image — banner on mobile, left column on desktop */}
      {event.eventImageUrl && (
        <div className="md:w-44 flex-shrink-0 self-stretch">
          <img
            src={event.eventImageUrl}
            alt=""
            className="w-full h-32 md:h-full object-cover"
          />
        </div>
      )}

      {/* Right side: header + body */}
      <div className="flex-1 min-w-0">
      {/* Event header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white truncate">{event.name}</h2>
          {event.hostName && (
            <p className="text-xs text-white/40">Hosted by {event.hostName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <a
            href={`/host/${event.slug}/report`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            title="View event report"
          >
            <BarChart3 size={14} />
            Report
          </a>
          <a
            href={`/${event.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/30 hover:text-white/60 transition-colors"
            title="View event page"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>

      {/* Event body */}
      <div className="px-5 py-4 space-y-5">
        {/* Row 1: Event info + RSVP count */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <EventInfoCard
              date={event.date}
              timezone={event.timezone}
              address={event.address}
              venueName={event.venueName}
            />
          </div>
          <div className="flex items-center">
            <RsvpCounter
              rsvpCount={event.rsvpCount}
              maxGuests={event.maxGuests}
            />
          </div>
        </div>

        {/* Co-hosts */}
        {visibleCoHosts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Co-hosts</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleCoHosts.map((host: CoHost, i: number) => (
                <span
                  key={host.id || i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-xs text-white/60"
                >
                  {host.avatar_url && (
                    <img src={host.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                  )}
                  {host.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Budget */}
        {event.budget && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Budget</span>
            </div>
            <BudgetSummary budget={event.budget} />
          </div>
        )}

        {/* Checklist */}
        {event.checklist.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Checklist</span>
            </div>
            <SponsorChecklist
              items={event.checklist}
              onToggle={onToggleChecklist}
            />
          </div>
        )}
      </div>
      </div>{/* closes flex-1 wrapper */}
    </div>
  );
}
