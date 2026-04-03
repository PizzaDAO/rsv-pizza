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
  Loader2, Shield, Tag, ExternalLink, ClipboardList, MapPin, DollarSign, Users,
  Search, Calendar, ArrowUpDown, X,
} from 'lucide-react';
import type { SponsorDashboardEvent, SponsorMeResponse, SponsorDashboardData, CoHost } from '../types';

// ============================================
// Types & helpers for filtering
// ============================================

type TimeFilter = 'all' | 'upcoming' | 'past';
type SortOption = 'date-asc' | 'date-desc' | 'name' | 'rsvps';

/** Extract city from an address string (usually the component after the first comma) */
function extractCity(address: string | null): string | null {
  if (!address) return null;
  // Common pattern: "123 Main St, CityName, State ZIP" or "Venue, City, Country"
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    // The second part is usually the city; strip leading numbers (zip-like prefixes)
    const candidate = parts[1].replace(/^\d+\s*/, '').trim();
    // If it looks like a state abbreviation or zip, try part[0]
    if (candidate.length <= 2 || /^\d+$/.test(candidate)) return parts[0];
    return candidate;
  }
  return parts[0];
}

function isUpcoming(date: string | null): boolean {
  if (!date) return false;
  return new Date(date) >= new Date();
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
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');

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

  const availableCities = useMemo(() => {
    const cities = new Set<string>();
    allEvents.forEach(e => {
      const city = extractCity(e.address);
      if (city) cities.add(city);
    });
    return Array.from(cities).sort();
  }, [allEvents]);

  const events = useMemo(() => {
    let filtered = allEvents;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.hostName && e.hostName.toLowerCase().includes(q)) ||
        (e.venueName && e.venueName.toLowerCase().includes(q)) ||
        (e.address && e.address.toLowerCase().includes(q))
      );
    }

    if (timeFilter === 'upcoming') {
      filtered = filtered.filter(e => isUpcoming(e.date));
    } else if (timeFilter === 'past') {
      filtered = filtered.filter(e => !isUpcoming(e.date));
    }

    if (selectedCity) {
      filtered = filtered.filter(e => extractCity(e.address) === selectedCity);
    }

    const sorted = [...filtered];
    switch (sortBy) {
      case 'date-asc':
        sorted.sort((a, b) => {
          if (!a.date) return 1;
          if (!b.date) return -1;
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        });
        break;
      case 'date-desc':
        sorted.sort((a, b) => {
          if (!a.date) return 1;
          if (!b.date) return -1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        });
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'rsvps':
        sorted.sort((a, b) => b.rsvpCount - a.rsvpCount);
        break;
    }

    return sorted;
  }, [allEvents, searchQuery, timeFilter, selectedCity, sortBy]);

  const hasActiveFilters = searchQuery.trim() !== '' || timeFilter !== 'all' || selectedCity !== null;

  function clearAllFilters() {
    setSearchQuery('');
    setTimeFilter('all');
    setSelectedCity(null);
    setSortBy('date-desc');
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
            {/* Row 1: Search + Sort */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <IconInput
                  icon={Search}
                  type="search"
                  placeholder="Search events, hosts, venues..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                />
              </div>
              <div className="relative flex-shrink-0">
                <ArrowUpDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="w-full sm:w-48 !pl-10 appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    paddingRight: '36px',
                  }}
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="name">Name A-Z</option>
                  <option value="rsvps">Most RSVPs</option>
                </select>
              </div>
            </div>

            {/* Row 2: Time filter + City pills */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Time filter pills */}
              <div className="flex items-center gap-1 mr-2">
                <Calendar size={14} className="text-white/40" />
                {(['all', 'upcoming', 'past'] as TimeFilter[]).map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeFilter(tf)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      timeFilter === tf
                        ? 'border-[#ff393a] text-white bg-[#ff393a]/20'
                        : 'border-white/10 text-white/50 hover:text-white/70'
                    }`}
                  >
                    {tf === 'all' ? 'All dates' : tf === 'upcoming' ? 'Upcoming' : 'Past'}
                  </button>
                ))}
              </div>

              {/* City filter pills (only show if there are multiple cities) */}
              {availableCities.length > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <MapPin size={14} className="text-white/40 mr-1" />
                  <button
                    onClick={() => setSelectedCity(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      selectedCity === null
                        ? 'border-[#ff393a] text-white bg-[#ff393a]/20'
                        : 'border-white/10 text-white/50 hover:text-white/70'
                    }`}
                  >
                    All cities
                  </button>
                  {availableCities.map(city => (
                    <button
                      key={city}
                      onClick={() => setSelectedCity(city)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        selectedCity === city
                          ? 'border-[#ff393a] text-white bg-[#ff393a]/20'
                          : 'border-white/10 text-white/50 hover:text-white/70'
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              )}

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
                >
                  <X size={12} />
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
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Event header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {event.eventImageUrl && (
            <img
              src={event.eventImageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{event.name}</h2>
            {event.hostName && (
              <p className="text-xs text-white/40">Hosted by {event.hostName}</p>
            )}
          </div>
        </div>
        <a
          href={`/${event.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 ml-2"
          title="View event page"
        >
          <ExternalLink size={16} />
        </a>
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
    </div>
  );
}
